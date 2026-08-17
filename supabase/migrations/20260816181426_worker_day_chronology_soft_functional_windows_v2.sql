create or replace function atlas.worker_day_chronology_overlay_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb:=coalesce(p_plan,'{}'::jsonb);
  v_shape jsonb;
  v_shape_state text;
  v_timezone text:='America/Chicago';
  v_shift_start timestamptz;
  v_shift_end timestamptz;
  v_noon timestamptz;
  v_evening timestamptz;
  v_free tstzmultirange;
  v_span tstzrange;
  v_entry record;
  v_item jsonb;
  v_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_state text;
  v_window_strength text;
  v_preferred_window text;
  v_fallback_used boolean;
  v_items jsonb:='[]'::jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_unplaced integer:=0;
  v_committed integer:=coalesce((v_plan->>'committedPaidMinutes')::integer,0);
  v_heavy integer:=0;
  v_capacity jsonb;
begin
  if p_day is null then raise exception 'A service date is required.' using errcode='22023'; end if;

  v_shape:=atlas.worker_day_shape_effective_v1(p_farm_id,p_membership_id,p_day);
  v_shape_state:=coalesce(v_shape->>'state','anchor_required');
  v_timezone:=coalesce(nullif(v_shape->>'timezone',''),'America/Chicago');

  select coalesce(jsonb_agg(jsonb_build_object(
    'blockKind',b.block_kind,'blockId',b.block_id,'title',b.title,
    'startsAt',b.starts_at,'endsAt',b.ends_at,'source',b.source
  ) order by b.starts_at,b.ends_at,b.block_id),'[]'::jsonb)
  into v_blocks
  from atlas.member_day_capacity_blocks_v1(p_farm_id,p_membership_id,p_day) b;

  select coalesce(sum(capacity.expected_active_minutes) filter(where capacity.physical_load='heavy'),0)::integer
  into v_heavy
  from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item
  join atlas.tasks t on t.id=(item->>'taskId')::uuid
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity;

  v_capacity:=atlas.clock_day_capacity_state_v2(p_farm_id,p_membership_id,p_day,v_committed,v_heavy);

  if v_shape_state='resolved' then
    v_shift_start:=(v_shape->>'startsAt')::timestamptz;
    v_shift_end:=(v_shape->>'endsAt')::timestamptz;
    v_noon:=(p_day::timestamp+time '12:00') at time zone v_timezone;
    v_evening:=(p_day::timestamp+time '17:00') at time zone v_timezone;
    v_free:=tstzmultirange(tstzrange(v_shift_start,v_shift_end,'[)'));

    for v_span in
      select tstzrange(b.starts_at,b.ends_at,'[)')
      from atlas.member_day_capacity_blocks_v1(p_farm_id,p_membership_id,p_day) b
      where b.ends_at>b.starts_at
    loop
      v_free:=v_free-tstzmultirange(v_span);
    end loop;

    for v_span in
      select tstzrange(
        placement.planned_start_at,
        placement.planned_start_at+make_interval(mins=>greatest(coalesce(placement.planned_duration_minutes,capacity.expected_active_minutes,0),0)),
        '[)'
      )
      from atlas.worker_day_task_placements placement
      join atlas.tasks task on task.id=placement.task_id
      cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
      where placement.farm_id=p_farm_id and placement.membership_id=p_membership_id
        and placement.service_date=p_day and placement.state='placed'
        and placement.planned_start_at is not null
        and greatest(coalesce(placement.planned_duration_minutes,capacity.expected_active_minutes,0),0)>0
    loop
      v_free:=v_free-tstzmultirange(v_span);
    end loop;
  end if;

  for v_entry in
    select e.value,e.ordinality
    from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) with ordinality e(value,ordinality)
    order by e.ordinality
  loop
    v_item:=v_entry.value;
    v_task_id:=(v_item->>'taskId')::uuid;
    select * into v_task from atlas.tasks where id=v_task_id;
    v_duration:=greatest(coalesce((v_item->>'expectedActiveMinutes')::integer,0),0);
    v_start:=null; v_end:=null; v_window_start:=null; v_window_end:=null;
    v_state:=null; v_fallback_used:=false;
    v_preferred_window:=coalesce(v_item->>'dayWindow','');

    -- Explicit task temporal truth is binding. Generic function-family dayparts are preferences.
    v_window_strength:=case
      when lower(coalesce(v_task.metadata->>'work_window_key','')) in ('morning','afternoon','evening') then 'explicit'
      when lower(coalesce(v_task.metadata->>'daypart','')) in ('morning','afternoon','evening') then 'explicit'
      when lower(coalesce(v_task.metadata->>'work_order_anchor','')) in ('top','morning','upper','first','midday','midday_flex','visibility','visibility_prep','anchored','afternoon','evening','lower','bottom','last','last_thing') then 'explicit'
      else 'functional_preference'
    end;

    select placement.* into v_placement
    from atlas.worker_day_task_placements placement
    where placement.farm_id=p_farm_id and placement.membership_id=p_membership_id
      and placement.task_id=v_task_id and placement.service_date=p_day and placement.state='placed'
    limit 1;

    if v_placement.id is not null and v_placement.planned_start_at is not null then
      v_duration:=greatest(coalesce(v_placement.planned_duration_minutes,v_duration,0),0);
      v_start:=v_placement.planned_start_at;
      v_end:=v_start+make_interval(mins=>v_duration);
      v_state:='committed_timed';
    elsif v_duration=0 then
      v_state:='visible_noncounting';
    elsif v_shape_state<>'resolved' then
      v_state:=case when v_shape_state='policy_conflict' then 'blocked_policy_conflict' else 'awaiting_day_shape' end;
      v_unplaced:=v_unplaced+1;
    else
      case v_preferred_window
        when 'morning' then v_window_start:=v_shift_start; v_window_end:=least(v_shift_end,v_noon);
        when 'afternoon' then v_window_start:=greatest(v_shift_start,v_noon); v_window_end:=least(v_shift_end,v_evening);
        when 'evening' then v_window_start:=greatest(v_shift_start,v_evening); v_window_end:=v_shift_end;
        else v_window_start:=v_shift_start; v_window_end:=v_shift_end;
      end case;

      if v_window_end>v_window_start then
        select greatest(lower(free_span),v_window_start)
        into v_start
        from unnest(v_free) free_span
        where upper(free_span)>v_window_start and lower(free_span)<v_window_end
          and greatest(lower(free_span),v_window_start)+make_interval(mins=>v_duration)<=least(upper(free_span),v_window_end)
        order by greatest(lower(free_span),v_window_start)
        limit 1;
      end if;

      -- A generic function-family daypart is a preference, not a lawful exclusion.
      -- If it cannot fit, use the earliest lawful free interval anywhere in the worker day.
      if v_start is null and v_window_strength='functional_preference' then
        select lower(free_span)
        into v_start
        from unnest(v_free) free_span
        where lower(free_span)+make_interval(mins=>v_duration)<=upper(free_span)
        order by lower(free_span)
        limit 1;
        v_fallback_used:=v_start is not null;
      end if;

      if v_start is null then
        v_state:='unplaced_no_lawful_interval';
        v_unplaced:=v_unplaced+1;
      else
        v_end:=v_start+make_interval(mins=>v_duration);
        v_state:=case when v_fallback_used then 'proposed_outside_preferred_window' else 'proposed' end;
        v_free:=v_free-tstzmultirange(tstzrange(v_start,v_end,'[)'));
      end if;
    end if;

    v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object(
      'sequenceIndex',v_entry.ordinality,
      'chronologyState',v_state,
      'startsAt',v_start,'endsAt',v_end,'durationMinutes',v_duration,
      'timelineAuthority',case when v_state='committed_timed' then 'committed' when v_state in ('proposed','proposed_outside_preferred_window') then 'proposal' else 'none' end,
      'preferredDayWindow',nullif(v_preferred_window,''),
      'dayWindowStrength',v_window_strength,
      'preferredWindowFallbackUsed',v_fallback_used,
      'proposalWindowStart',v_window_start,'proposalWindowEnd',v_window_end
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','worker_day_chronology_v2',
    'farmId',p_farm_id,'membershipId',p_membership_id,'serviceDate',p_day,
    'state',case
      when v_shape_state='policy_conflict' then 'policy_conflict'
      when v_shape_state<>'resolved' then 'anchor_required'
      when v_unplaced>0 then 'conflict'
      else 'proposed'
    end,
    'proposalIsAuthoritative',false,
    'dayShape',v_shape,'blocks',v_blocks,'items',v_items,
    'nextUp',coalesce(v_plan->'nextUp','[]'::jsonb),
    'unplacedCount',v_unplaced,'clockCapacity',v_capacity
  );
end;
$$;