-- Pass 3E — Worker Day chronology proposal foundation
-- Governing boundary:
--   * Day Shape is owner-authored policy, never inferred from accidental task history.
--   * Chronology is a read-only proposal until a human commits Clock placements.
--   * Existing committed exact times remain authoritative.
--   * Without an effective Day Shape anchor, Atlas returns anchor_required rather than inventing a shift start.

create table if not exists atlas.worker_day_shape_policies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  membership_id uuid not null references atlas.farm_memberships(id) on delete cascade,
  policy_key text not null,
  policy_name text not null,
  version integer not null,
  weekdays smallint[] not null,
  local_start time without time zone not null,
  local_end time without time zone not null,
  effective_from date not null,
  effective_through date null,
  active boolean not null default true,
  authored_by_user_id uuid null,
  authored_reason text null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint worker_day_shape_policy_key_nonempty check (btrim(policy_key) <> ''),
  constraint worker_day_shape_policy_name_nonempty check (btrim(policy_name) <> ''),
  constraint worker_day_shape_policy_version_positive check (version > 0),
  constraint worker_day_shape_policy_weekdays check (
    cardinality(weekdays) between 1 and 7
    and weekdays <@ array[0,1,2,3,4,5,6]::smallint[]
  ),
  constraint worker_day_shape_policy_local_span check (local_end > local_start),
  constraint worker_day_shape_policy_effective_span check (effective_through is null or effective_through >= effective_from),
  constraint worker_day_shape_policy_version_key unique (membership_id, policy_key, version)
);

create index if not exists worker_day_shape_policies_effective_idx
  on atlas.worker_day_shape_policies (farm_id, membership_id, active, effective_from, effective_through);

alter table atlas.worker_day_shape_policies enable row level security;
revoke all on table atlas.worker_day_shape_policies from public, anon, authenticated;
grant select, insert, update, delete on table atlas.worker_day_shape_policies to service_role;

create or replace function atlas.worker_day_shape_effective_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_timezone text := 'America/Chicago';
  v_match_count integer := 0;
  v_policy atlas.worker_day_shape_policies%rowtype;
  v_active_target integer := 0;
  v_configured_max integer := 0;
  v_expected_elapsed integer := 0;
  v_starts_at timestamptz;
  v_ends_at timestamptz;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  ) then
    raise exception 'Active worker membership required.' using errcode='P0002';
  end if;

  select coalesce(nullif(f.metadata->>'timezone',''),'America/Chicago')
  into v_timezone
  from atlas.farms f
  where f.id=p_farm_id;

  select
    coalesce(mcs.regular_target_minutes,0),
    coalesce(mcs.maximum_planned_minutes,0),
    coalesce(nullif(mcs.metadata->>'elapsed_workday_minutes','')::integer,0)
  into v_active_target,v_configured_max,v_expected_elapsed
  from atlas.member_capacity_settings mcs
  where mcs.farm_id=p_farm_id and mcs.membership_id=p_membership_id and mcs.active=true
  order by mcs.updated_at desc nulls last, mcs.created_at desc nulls last
  limit 1;

  select count(*)::integer
  into v_match_count
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day)
    and extract(dow from p_day)::smallint=any(policy.weekdays);

  if v_match_count=0 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1',
      'serviceDate',p_day,
      'state','anchor_required',
      'requiresOwnerDayShape',true,
      'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,
      'matchingPolicyCount',0
    );
  end if;

  if v_match_count>1 then
    return jsonb_build_object(
      'contractVersion','worker_day_shape_effective_v1',
      'serviceDate',p_day,
      'state','policy_conflict',
      'requiresOwnerDayShape',true,
      'timezone',v_timezone,
      'configuredActiveTargetMinutes',v_active_target,
      'configuredMaximumPlannedMinutes',v_configured_max,
      'expectedElapsedWorkdayMinutes',v_expected_elapsed,
      'matchingPolicyCount',v_match_count
    );
  end if;

  select policy.*
  into v_policy
  from atlas.worker_day_shape_policies policy
  where policy.farm_id=p_farm_id
    and policy.membership_id=p_membership_id
    and policy.active=true
    and policy.effective_from<=p_day
    and (policy.effective_through is null or policy.effective_through>=p_day)
    and extract(dow from p_day)::smallint=any(policy.weekdays)
  order by policy.effective_from desc,policy.version desc,policy.created_at desc
  limit 1;

  v_starts_at := (p_day::timestamp + v_policy.local_start) at time zone v_timezone;
  v_ends_at := (p_day::timestamp + v_policy.local_end) at time zone v_timezone;

  return jsonb_build_object(
    'contractVersion','worker_day_shape_effective_v1',
    'serviceDate',p_day,
    'state','resolved',
    'requiresOwnerDayShape',false,
    'timezone',v_timezone,
    'matchingPolicyCount',1,
    'policyId',v_policy.id,
    'policyKey',v_policy.policy_key,
    'policyName',v_policy.policy_name,
    'policyVersion',v_policy.version,
    'weekdays',to_jsonb(v_policy.weekdays),
    'localStart',v_policy.local_start,
    'localEnd',v_policy.local_end,
    'startsAt',v_starts_at,
    'endsAt',v_ends_at,
    'elapsedMinutes',(extract(epoch from (v_ends_at-v_starts_at))/60.0)::integer,
    'configuredActiveTargetMinutes',v_active_target,
    'configuredMaximumPlannedMinutes',v_configured_max,
    'expectedElapsedWorkdayMinutes',v_expected_elapsed,
    'effectiveFrom',v_policy.effective_from,
    'effectiveThrough',v_policy.effective_through,
    'metadata',v_policy.metadata
  );
end;
$$;

revoke all on function atlas.worker_day_shape_effective_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_day_shape_effective_v1(uuid,uuid,date) to service_role;

create or replace function atlas.worker_day_chronology_overlay_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
)
returns jsonb
language plpgsql
stable
security definer
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
  v_task_id uuid;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_duration integer;
  v_start timestamptz;
  v_end timestamptz;
  v_window_start timestamptz;
  v_window_end timestamptz;
  v_state text;
  v_items jsonb:='[]'::jsonb;
  v_blocks jsonb:='[]'::jsonb;
  v_unplaced integer:=0;
  v_committed integer:=coalesce((v_plan->>'committedPaidMinutes')::integer,0);
  v_heavy integer:=0;
  v_capacity jsonb;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  v_shape:=atlas.worker_day_shape_effective_v1(p_farm_id,p_membership_id,p_day);
  v_shape_state:=coalesce(v_shape->>'state','anchor_required');
  v_timezone:=coalesce(nullif(v_shape->>'timezone',''),'America/Chicago');

  select coalesce(jsonb_agg(jsonb_build_object(
    'blockKind',b.block_kind,
    'blockId',b.block_id,
    'title',b.title,
    'startsAt',b.starts_at,
    'endsAt',b.ends_at,
    'source',b.source
  ) order by b.starts_at,b.ends_at,b.block_id),'[]'::jsonb)
  into v_blocks
  from atlas.member_day_capacity_blocks_v1(p_farm_id,p_membership_id,p_day) b;

  select coalesce(sum(capacity.expected_active_minutes) filter (where capacity.physical_load='heavy'),0)::integer
  into v_heavy
  from jsonb_array_elements(coalesce(v_plan->'realWork','[]'::jsonb)) item
  join atlas.tasks t on t.id=(item->>'taskId')::uuid
  cross join lateral atlas.task_capacity_plan_v1(t,p_day) capacity;

  v_capacity:=atlas.clock_day_capacity_state_v2(p_farm_id,p_membership_id,p_day,v_committed,v_heavy);

  if v_shape_state='resolved' then
    v_shift_start:=(v_shape->>'startsAt')::timestamptz;
    v_shift_end:=(v_shape->>'endsAt')::timestamptz;
    v_noon:=(p_day::timestamp + time '12:00') at time zone v_timezone;
    v_evening:=(p_day::timestamp + time '17:00') at time zone v_timezone;
    v_free:=tstzmultirange(tstzrange(v_shift_start,v_shift_end,'[)'));

    -- Capacity-blocking reservations and partial unavailability are unavailable proposal space.
    for v_span in
      select tstzrange(b.starts_at,b.ends_at,'[)')
      from atlas.member_day_capacity_blocks_v1(p_farm_id,p_membership_id,p_day) b
      where b.ends_at>b.starts_at
    loop
      v_free:=v_free-tstzmultirange(v_span);
    end loop;

    -- Existing exact committed Clock placements own their intervals before proposals are generated.
    for v_span in
      select tstzrange(
        placement.planned_start_at,
        placement.planned_start_at + make_interval(mins=>greatest(coalesce(placement.planned_duration_minutes,capacity.expected_active_minutes,0),0)),
        '[)'
      )
      from atlas.worker_day_task_placements placement
      join atlas.tasks task on task.id=placement.task_id
      cross join lateral atlas.task_capacity_plan_v1(task,p_day) capacity
      where placement.farm_id=p_farm_id
        and placement.membership_id=p_membership_id
        and placement.service_date=p_day
        and placement.state='placed'
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
    v_duration:=greatest(coalesce((v_item->>'expectedActiveMinutes')::integer,0),0);
    v_start:=null;
    v_end:=null;
    v_window_start:=null;
    v_window_end:=null;
    v_state:=null;

    select placement.* into v_placement
    from atlas.worker_day_task_placements placement
    where placement.farm_id=p_farm_id
      and placement.membership_id=p_membership_id
      and placement.task_id=v_task_id
      and placement.service_date=p_day
      and placement.state='placed'
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
      case coalesce(v_item->>'dayWindow','')
        when 'morning' then
          v_window_start:=v_shift_start;
          v_window_end:=least(v_shift_end,v_noon);
        when 'afternoon' then
          v_window_start:=greatest(v_shift_start,v_noon);
          v_window_end:=least(v_shift_end,v_evening);
        when 'evening' then
          v_window_start:=greatest(v_shift_start,v_evening);
          v_window_end:=v_shift_end;
        else
          v_window_start:=v_shift_start;
          v_window_end:=v_shift_end;
      end case;

      if v_window_end>v_window_start then
        select greatest(lower(free_span),v_window_start)
        into v_start
        from unnest(v_free) free_span
        where upper(free_span)>v_window_start
          and lower(free_span)<v_window_end
          and greatest(lower(free_span),v_window_start)+make_interval(mins=>v_duration)<=least(upper(free_span),v_window_end)
        order by greatest(lower(free_span),v_window_start)
        limit 1;
      end if;

      if v_start is null then
        v_state:='unplaced_no_lawful_interval';
        v_unplaced:=v_unplaced+1;
      else
        v_end:=v_start+make_interval(mins=>v_duration);
        v_state:='proposed';
        v_free:=v_free-tstzmultirange(tstzrange(v_start,v_end,'[)'));
      end if;
    end if;

    v_items:=v_items||jsonb_build_array(v_item||jsonb_build_object(
      'sequenceIndex',v_entry.ordinality,
      'chronologyState',v_state,
      'startsAt',v_start,
      'endsAt',v_end,
      'durationMinutes',v_duration,
      'timelineAuthority',case when v_state='committed_timed' then 'committed' when v_state='proposed' then 'proposal' else 'none' end,
      'proposalWindowStart',v_window_start,
      'proposalWindowEnd',v_window_end
    ));
  end loop;

  return jsonb_build_object(
    'contractVersion','worker_day_chronology_v1',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_day,
    'state',case
      when v_shape_state='policy_conflict' then 'policy_conflict'
      when v_shape_state<>'resolved' then 'anchor_required'
      when v_unplaced>0 then 'conflict'
      else 'proposed'
    end,
    'proposalIsAuthoritative',false,
    'dayShape',v_shape,
    'blocks',v_blocks,
    'items',v_items,
    'nextUp',coalesce(v_plan->'nextUp','[]'::jsonb),
    'unplacedCount',v_unplaced,
    'clockCapacity',v_capacity
  );
end;
$$;

revoke all on function atlas.worker_day_chronology_overlay_v1(uuid,uuid,date,jsonb) from public,anon,authenticated;
grant execute on function atlas.worker_day_chronology_overlay_v1(uuid,uuid,date,jsonb) to service_role;

-- Owner inspection receives the same canonical selection plus the chronology proposal.
create or replace function atlas.owner_worker_day_plan_choreographed_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.user_id=auth.uid() and fm.farm_id=p_farm_id and fm.active=true and fm.role='owner') then
    raise exception 'Owner farm membership required.' using errcode='42501';
  end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then
    raise exception 'Active Farm Hand membership required.' using errcode='42501';
  end if;
  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan),true);
  return v_plan;
end;
$$;

-- Farm Hand receives the identical chronology over the same canonical selection, with Owner-only suggestions removed.
create or replace function atlas.worker_self_day_plan_api_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_plan jsonb;
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if p_day is null then raise exception 'A worker day is required.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.farm_memberships membership where membership.id=p_membership_id and membership.farm_id=p_farm_id
    and membership.user_id=auth.uid() and membership.active=true and membership.role='farm_hand') then
    raise exception 'The Farm Hand Worker Day plan may only be read by that active Farm Hand.' using errcode='42501';
  end if;
  v_plan:=atlas.owner_worker_day_plan_choreographed_v1(p_farm_id,p_membership_id,p_day);
  v_plan:=atlas.worker_day_selection_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=atlas.enrich_worker_day_plan_clock_capacity_v1(p_farm_id,p_membership_id,p_day,v_plan);
  v_plan:=jsonb_set(v_plan,'{suggestions}','[]'::jsonb,true);
  v_plan:=jsonb_set(v_plan,'{clockTimeline}',atlas.worker_day_chronology_overlay_v1(p_farm_id,p_membership_id,p_day,v_plan),true);
  v_plan:=jsonb_set(v_plan,'{contractVersion}',to_jsonb('worker_self_day_plan_v1'::text),true);
  return v_plan;
end;
$$;

-- Existing authenticated endpoint grants remain intentional; internal helpers stay off the public Data API.
revoke all on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.owner_worker_day_plan_choreographed_api_v1(uuid,uuid,date) to authenticated,service_role;
revoke all on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) from public,anon;
grant execute on function atlas.worker_self_day_plan_api_v1(uuid,uuid,date) to authenticated,service_role;
