-- Weed Card presentation must follow the physical bed and its crop history, not the
-- lifecycle of the persistent Weed Card itself. Keep the existing authenticated RPC
-- signature and mutation boundaries; this is a read-contract refinement only.

create or replace function atlas.weed_card_task_focus_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_card atlas.weed_cards%rowtype;
  v_pass atlas.weed_passes%rowtype;
  v_object atlas.growing_objects%rowtype;
  v_state atlas.object_state%rowtype;
  v_latest_session atlas.weed_sessions%rowtype;
  v_zone_label text;
  v_role text;
  v_membership_id uuid;
  v_sessions jsonb;
  v_occupancy jsonb;
  v_condition text;
  v_state_logged_on date;
  v_state_condition text;
  v_state_last_weeded_on date;
  v_last_weeded_on date;
  v_last_logged_condition text;
  v_last_logged_on date;
  v_bed_use_category text;
  v_bed_trail jsonb;
begin
  select t.* into v_task from atlas.tasks t where t.id=p_task_id;
  if v_task.id is null then raise exception 'Task not found.' using errcode='P0002'; end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);
  if not atlas.is_farm_owner(v_task.farm_id)
     and not (v_role in ('farm_hand','manager') and v_membership_id is not null and v_task.assigned_membership_id=v_membership_id)
  then
    raise exception 'This Weed Card is not available to the signed-in farm member.' using errcode='42501';
  end if;

  select c.* into v_card
  from atlas.weed_cards c join atlas.task_objects x on x.object_id=c.object_id
  where x.task_id=p_task_id limit 1;
  if v_card.id is null then return null; end if;

  select p.* into v_pass from atlas.weed_passes p
  where p.weed_card_id=v_card.id and p.status='active' limit 1;

  v_condition := coalesce(v_pass.current_condition,atlas.weed_card_condition_from_text_v1(v_task.metadata->>'condition'),v_card.current_condition);
  select go.* into v_object from atlas.growing_objects go where go.id=v_card.object_id;
  select os.* into v_state from atlas.object_state os where os.object_id=v_object.id;
  select z.label into v_zone_label from atlas.zones z where z.id=v_object.zone_id;
  v_occupancy := atlas.object_crop_occupancy_v1(v_object.id);

  select ws.* into v_latest_session
  from atlas.weed_sessions ws
  where ws.weed_card_id=v_card.id
  order by ws.work_date desc, ws.recorded_at desc
  limit 1;

  v_state_last_weeded_on := case
    when v_state.last_weeded_at is not null
      then (v_state.last_weeded_at at time zone 'America/Chicago')::date
    else null
  end;

  v_last_weeded_on := case
    when v_latest_session.work_date is null then v_state_last_weeded_on
    when v_state_last_weeded_on is null then v_latest_session.work_date
    else greatest(v_latest_session.work_date,v_state_last_weeded_on)
  end;

  v_state_logged_on := coalesce(
    case
      when v_state.last_checked_at is not null
        then (v_state.last_checked_at at time zone 'America/Chicago')::date
      else null
    end,
    case
      when coalesce(v_state.metadata->>'photo_truth_date','') ~ '^\d{4}-\d{2}-\d{2}$'
        then (v_state.metadata->>'photo_truth_date')::date
      else null
    end
  );

  v_state_condition := case lower(coalesce(v_state.weed_pressure,''))
    when 'high' then 'heavy'
    when 'heavy' then 'heavy'
    when 'severe' then 'heavy'
    when 'medium' then 'heavy'
    when 'moderate' then 'heavy'
    when 'low' then 'mostly_clear'
    when 'light' then 'mostly_clear'
    when 'maintained' then 'clear'
    when 'none' then 'clear'
    when 'clear' then 'clear'
    else null
  end;

  -- A Weed session and an object-state check are both observations of the physical
  -- bed. Keep the date and condition from the newest observation together.
  if v_latest_session.id is not null
     and (v_state_logged_on is null or v_latest_session.work_date >= v_state_logged_on)
  then
    v_last_logged_on := v_latest_session.work_date;
    v_last_logged_condition := coalesce(v_latest_session.condition_after,v_state_condition,v_condition);
  elsif v_state_logged_on is not null then
    v_last_logged_on := v_state_logged_on;
    v_last_logged_condition := coalesce(v_state_condition,v_condition,v_latest_session.condition_after);
  else
    v_last_logged_on := coalesce(v_latest_session.work_date,v_last_weeded_on);
    v_last_logged_condition := coalesce(v_latest_session.condition_after,v_state_condition,v_condition);
  end if;

  -- Prefer an explicit owner-curated current use. Fall back only to established
  -- object/zone semantics; mixed beds stay mixed rather than being misclassified.
  v_bed_use_category := coalesce(
    nullif(v_object.metadata->>'current_bed_use_category',''),
    case lower(coalesce(v_object.metadata->>'use',''))
      when 'cut_flower_production' then 'Cut flower production'
      when 'perennial_cut_flower' then 'Perennial cut flower'
      when 'hospitality' then 'Hospitality'
      when 'landscaping' then 'Landscaping'
      when 'landscape' then 'Landscaping'
      when 'production' then 'Production'
      else null
    end,
    case lower(coalesce(v_object.metadata->>'production_lane',''))
      when 'cut_flower' then 'Cut flower production'
      when 'production' then 'Production'
      else null
    end,
    case lower(coalesce(v_object.metadata->>'management_group',''))
      when 'production' then 'Production'
      when 'hospitality' then 'Hospitality'
      when 'landscaping' then 'Landscaping'
      else null
    end,
    case
      when lower(coalesce(v_object.metadata->>'perennial_zone','')) in ('true','1','yes','y') then 'Perennial bed'
      when lower(coalesce(v_object.metadata->>'landscape_strip','')) in ('true','1','yes','y') then 'Landscaping'
      when lower(coalesce(v_state.metadata->>'role','')) like '%mixed%' then 'Mixed bed'
      when lower(coalesce(v_state.metadata->>'purpose','')) like '%hospitality%' then 'Hospitality'
      when lower(coalesce(v_state.metadata->>'purpose','')) like '%landscap%' then 'Landscaping'
      when lower(coalesce(v_state.metadata->>'purpose','')) like '%production%' then 'Production'
      else null
    end,
    'Unclassified'
  );

  -- Bed Trail: completed sow/plant/transplant/tending history attached to this bed.
  -- An owner may later pin one crop with metadata.weed_trail_primary_crop_cycle_id.
  with candidates as (
    select distinct on (t.id)
      t.id as task_id,
      t.title,
      t.action_key,
      coalesce(t.completed_at::date,t.due_date,t.created_at::date) as event_date,
      linked.crop_cycle_id,
      coalesce(linked.crop_label,matched_perennial.crop_label) as crop_label,
      coalesce(linked.life_cycle,matched_perennial.life_cycle) as life_cycle,
      case
        when nullif(v_object.metadata->>'weed_trail_primary_crop_cycle_id','') is not null
         and linked.crop_cycle_id::text=v_object.metadata->>'weed_trail_primary_crop_cycle_id' then 0
        when lower(coalesce(linked.life_cycle,matched_perennial.life_cycle,''))='perennial' then 1
        else 2
      end as priority
    from atlas.task_objects x
    join atlas.tasks t on t.id=x.task_id
    left join lateral (
      select cc.id as crop_cycle_id, cc.crop_label, cp.life_cycle
      from atlas.task_crop_cycles tcc
      join atlas.crop_cycles cc on cc.id=tcc.crop_cycle_id
      left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
      where tcc.task_id=t.id
      order by
        (nullif(v_object.metadata->>'weed_trail_primary_crop_cycle_id','') is not null
          and cc.id::text=v_object.metadata->>'weed_trail_primary_crop_cycle_id') desc,
        (lower(coalesce(cp.life_cycle,''))='perennial') desc,
        tcc.created_at
      limit 1
    ) linked on true
    left join lateral (
      select cc.crop_label, cp.life_cycle
      from atlas.crop_cycles cc
      left join atlas.crop_profiles cp on cp.id=cc.crop_profile_id
      where cc.object_id=v_object.id
        and cc.lifecycle_status='active'
        and lower(coalesce(cp.life_cycle,''))='perennial'
        and lower(t.title) like '%'||lower(cc.crop_label)||'%'
      order by cc.created_at
      limit 1
    ) matched_perennial on linked.crop_cycle_id is null
    where x.object_id=v_object.id
      and t.status='done'
      and coalesce(t.action_key,'') <> 'weed'
      and coalesce(t.task_type,'') <> 'weeding'
      and (
        lower(coalesce(t.action_key,'')) in ('sow','plant','transplant','divide','deadhead','cut_back','prune','tend','perennial_tending')
        or lower(coalesce(t.task_type,'')) in ('sowing','planting','transplanting','perennial_tending')
      )
    order by t.id, priority, event_date desc
  ), ranked as (
    select * from candidates
    order by priority, event_date desc, title
    limit 5
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'taskId',r.task_id,
    'eventKind',case
      when lower(coalesce(r.action_key,''))='sow' then 'Sown'
      when lower(coalesce(r.action_key,''))='plant' then 'Planted'
      when lower(coalesce(r.action_key,''))='transplant' then 'Transplanted'
      when lower(coalesce(r.action_key,''))='deadhead' then 'Deadheaded'
      when lower(coalesce(r.action_key,'')) in ('divide','cut_back','prune','tend','perennial_tending') then 'Tended'
      else 'Worked'
    end,
    'cropCycleId',r.crop_cycle_id,
    'cropLabel',r.crop_label,
    'title',r.title,
    'lifeCycle',r.life_cycle,
    'eventDate',r.event_date
  )) order by r.priority,r.event_date desc),'[]'::jsonb)
  into v_bed_trail
  from ranked r;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'workDate',s.work_date,'minutes',s.minutes,'minutesKnown',s.minutes_known,
    'conditionBefore',s.condition_before,'conditionAfter',s.condition_after,'note',s.note,'recordedAt',s.recorded_at
  ) order by s.recorded_at desc),'[]'::jsonb)
  into v_sessions
  from (
    select ws.* from atlas.weed_sessions ws
    where ws.weed_card_id=v_card.id and (v_pass.id is null or ws.weed_pass_id=v_pass.id)
    order by ws.recorded_at desc limit 12
  ) s;

  return jsonb_build_object(
    'taskId',v_task.id,'taskStatus',v_task.status,'taskDueDate',v_task.due_date,
    'cardId',v_card.id,'passId',v_pass.id,'passStatus',coalesce(v_pass.status,'closed'),
    'objectId',v_object.id,'objectKey',v_object.stable_key,'objectLabel',v_object.label,
    'zoneLabel',coalesce(v_zone_label,'Elm Farm'),'occupancyGroups',coalesce(v_occupancy->'groups','[]'::jsonb),
    'condition',v_condition,'targetCondition',coalesce(v_pass.target_condition,v_card.target_condition),
    'lastWeededOn',v_last_weeded_on,
    'lastLoggedCondition',v_last_logged_condition,
    'lastLoggedOn',v_last_logged_on,
    'bedUseCategory',v_bed_use_category,
    'bedTrail',v_bed_trail,
    'totalMinutes',coalesce(v_pass.total_minutes,0),
    'sessionCount',case when v_pass.id is null then 0 else jsonb_array_length(v_sessions) end,
    'nextReviewOn',v_card.next_review_on,
    'sessions',case when v_pass.id is null then '[]'::jsonb else v_sessions end
  );
end;
$function$;
