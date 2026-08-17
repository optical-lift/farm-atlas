-- Pass 3C: make Worker Day capacity day-aware without creating another scheduler.
--
-- Existing authorities remain authoritative:
--   * atlas.member_capacity_settings: paid-minute and heavy-work limits
--   * atlas.member_unavailability: worker availability exceptions
--   * atlas.day_reservations: protected/fixed time inside the day
--   * atlas.worker_day_task_placements: committed Clock placement/timing
--   * atlas.task_capacity_profiles / task_capacity_plan_v1: task effort + physical load
--
-- Capacity is an arbitration/read contract only. It must never erase, suppress, or
-- rewrite upstream obligations in order to make a day fit.

alter table atlas.member_unavailability
  add column if not exists unavailable_local_start time without time zone,
  add column if not exists unavailable_local_end time without time zone;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'atlas.member_unavailability'::regclass
      and conname = 'member_unavailability_local_window_pair'
  ) then
    alter table atlas.member_unavailability
      add constraint member_unavailability_local_window_pair
      check (
        (unavailable_local_start is null and unavailable_local_end is null)
        or (
          unavailable_local_start is not null
          and unavailable_local_end is not null
          and unavailable_local_end > unavailable_local_start
        )
      );
  end if;
end;
$$;

comment on column atlas.member_unavailability.unavailable_local_start is
  'Optional America/Chicago local start for a partial-day unavailability window. NULL with unavailable_local_end NULL means the existing whole-day/date-range semantics.';
comment on column atlas.member_unavailability.unavailable_local_end is
  'Optional America/Chicago local end for a partial-day unavailability window. Must be paired with unavailable_local_start.';

create or replace function atlas.worker_day_available_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select extract(isodow from p_day) <> 7
    and not exists (
      select 1
      from atlas.member_unavailability u
      where u.farm_id = p_farm_id
        and u.membership_id = p_membership_id
        and u.active = true
        and p_day between u.unavailable_start and u.unavailable_end
        and u.unavailable_local_start is null
        and u.unavailable_local_end is null
    );
$function$;

create or replace function atlas.member_day_capacity_blocks_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date
)
returns table(
  block_kind text,
  block_id uuid,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  source text
)
language sql
stable
set search_path = pg_catalog, atlas
as $function$
  with day_bounds as (
    select
      (p_day::timestamp at time zone 'America/Chicago') as day_start,
      ((p_day + 1)::timestamp at time zone 'America/Chicago') as day_end
  )
  select
    'partial_unavailability'::text,
    u.id,
    coalesce(nullif(btrim(u.reason), ''), 'Unavailable')::text,
    (p_day::timestamp + u.unavailable_local_start) at time zone 'America/Chicago',
    (p_day::timestamp + u.unavailable_local_end) at time zone 'America/Chicago',
    u.source
  from atlas.member_unavailability u
  where u.farm_id = p_farm_id
    and u.membership_id = p_membership_id
    and u.active = true
    and p_day between u.unavailable_start and u.unavailable_end
    and u.unavailable_local_start is not null
    and u.unavailable_local_end is not null

  union all

  select
    'reservation'::text,
    r.id,
    r.title,
    greatest(r.starts_at, bounds.day_start),
    least(r.ends_at, bounds.day_end),
    r.source
  from atlas.day_reservations r
  cross join day_bounds bounds
  where r.farm_id = p_farm_id
    and r.membership_id = p_membership_id
    and r.service_date = p_day
    and r.active = true
    and r.ends_at > bounds.day_start
    and r.starts_at < bounds.day_end
    and lower(coalesce(nullif(r.metadata->>'capacityBlocking', ''), 'true')) not in ('false','0','no');
$function$;

revoke all on function atlas.member_day_capacity_blocks_v1(uuid,uuid,date) from public, anon, authenticated;
grant execute on function atlas.member_day_capacity_blocks_v1(uuid,uuid,date) to service_role;

create or replace function atlas.clock_day_capacity_state_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_planned_paid_minutes integer,
  p_planned_heavy_minutes integer default 0
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, atlas
as $function$
declare
  v_member_role text;
  v_target integer := 420;
  v_maximum integer := 480;
  v_heavy_cap integer := 210;
  v_planned integer := greatest(coalesce(p_planned_paid_minutes, 0), 0);
  v_planned_heavy integer := greatest(coalesce(p_planned_heavy_minutes, 0), 0);
  v_full_day_unavailable boolean := false;
  v_reservation_minutes integer := 0;
  v_partial_unavailable_minutes integer := 0;
  v_blocked_minutes integer := 0;
  v_effective_target integer := 0;
  v_effective_maximum integer := 0;
  v_over_target integer := 0;
  v_over_maximum integer := 0;
  v_over_heavy integer := 0;
  v_placed_task_minutes integer := 0;
  v_timed_placement_minutes integer := 0;
  v_interval_conflicts jsonb := '[]'::jsonb;
  v_pair_conflicts jsonb := '[]'::jsonb;
  v_block_conflicts jsonb := '[]'::jsonb;
  v_warning_codes jsonb := '[]'::jsonb;
  v_conflict_codes jsonb := '[]'::jsonb;
begin
  if p_day is null then
    raise exception 'A service date is required.' using errcode = '22023';
  end if;

  select fm.role
  into v_member_role
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_member_role is null then
    raise exception 'Active worker membership required.' using errcode = 'P0002';
  end if;

  select
    coalesce(mcs.regular_target_minutes, case v_member_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end),
    coalesce(mcs.maximum_planned_minutes, case v_member_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end),
    coalesce(mcs.heavy_minutes_soft_cap, case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end)
  into v_target, v_maximum, v_heavy_cap
  from atlas.member_capacity_settings mcs
  where mcs.farm_id = p_farm_id
    and mcs.membership_id = p_membership_id
    and mcs.active = true
  order by mcs.updated_at desc nulls last, mcs.created_at desc nulls last
  limit 1;

  v_target := coalesce(v_target, case v_member_role when 'farm_hand' then 420 when 'manager' then 360 else 480 end);
  v_maximum := greatest(coalesce(v_maximum, case v_member_role when 'farm_hand' then 480 when 'manager' then 480 else 600 end), v_target);
  v_heavy_cap := greatest(coalesce(v_heavy_cap, case v_member_role when 'farm_hand' then 210 when 'manager' then 240 else 300 end), 0);

  v_full_day_unavailable := not atlas.worker_day_available_v1(p_farm_id, p_membership_id, p_day);

  select
    coalesce(sum(extract(epoch from (b.ends_at - b.starts_at)) / 60.0) filter (where b.block_kind = 'reservation'), 0)::integer,
    coalesce(sum(extract(epoch from (b.ends_at - b.starts_at)) / 60.0) filter (where b.block_kind = 'partial_unavailability'), 0)::integer
  into v_reservation_minutes, v_partial_unavailable_minutes
  from atlas.member_day_capacity_blocks_v1(p_farm_id, p_membership_id, p_day) b;

  with merged as (
    select range_agg(tstzrange(b.starts_at, b.ends_at, '[)')) as spans
    from atlas.member_day_capacity_blocks_v1(p_farm_id, p_membership_id, p_day) b
    where b.ends_at > b.starts_at
  )
  select coalesce(sum(extract(epoch from (upper(span) - lower(span))) / 60.0), 0)::integer
  into v_blocked_minutes
  from merged
  cross join lateral unnest(coalesce(merged.spans, '{}'::tstzmultirange)) span;

  if v_full_day_unavailable then
    v_effective_maximum := 0;
  else
    v_effective_maximum := greatest(v_maximum - v_blocked_minutes, 0);
  end if;
  v_effective_target := least(v_target, v_effective_maximum);

  v_over_target := greatest(v_planned - v_effective_target, 0);
  v_over_maximum := greatest(v_planned - v_effective_maximum, 0);
  v_over_heavy := greatest(v_planned_heavy - v_heavy_cap, 0);

  with placements as (
    select
      p.id,
      p.task_id,
      t.title,
      p.planned_start_at,
      greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)::integer as duration_minutes,
      case
        when p.planned_start_at is null then null::tstzrange
        else tstzrange(
          p.planned_start_at,
          p.planned_start_at + make_interval(mins => greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)::integer),
          '[)'
        )
      end as span
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id = p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t, p_day) cp
    where p.farm_id = p_farm_id
      and p.membership_id = p_membership_id
      and p.service_date = p_day
      and p.state = 'placed'
      and t.status = 'open'
  )
  select
    coalesce(sum(duration_minutes), 0)::integer,
    coalesce(sum(duration_minutes) filter (where planned_start_at is not null), 0)::integer
  into v_placed_task_minutes, v_timed_placement_minutes
  from placements;

  with placements as (
    select
      p.id,
      p.task_id,
      t.title,
      p.planned_start_at,
      greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)::integer as duration_minutes,
      tstzrange(
        p.planned_start_at,
        p.planned_start_at + make_interval(mins => greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)::integer),
        '[)'
      ) as span
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id = p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t, p_day) cp
    where p.farm_id = p_farm_id
      and p.membership_id = p_membership_id
      and p.service_date = p_day
      and p.state = 'placed'
      and t.status = 'open'
      and p.planned_start_at is not null
      and greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', 'placement_overlap',
    'leftPlacementId', a.id,
    'leftTaskId', a.task_id,
    'leftTitle', a.title,
    'rightPlacementId', b.id,
    'rightTaskId', b.task_id,
    'rightTitle', b.title
  ) order by a.planned_start_at, b.planned_start_at, a.id, b.id), '[]'::jsonb)
  into v_pair_conflicts
  from placements a
  join placements b on a.id < b.id and a.span && b.span;

  with placements as (
    select
      p.id,
      p.task_id,
      t.title,
      p.planned_start_at,
      tstzrange(
        p.planned_start_at,
        p.planned_start_at + make_interval(mins => greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0)::integer),
        '[)'
      ) as span
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id = p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t, p_day) cp
    where p.farm_id = p_farm_id
      and p.membership_id = p_membership_id
      and p.service_date = p_day
      and p.state = 'placed'
      and t.status = 'open'
      and p.planned_start_at is not null
      and greatest(coalesce(p.planned_duration_minutes, cp.expected_active_minutes, 0), 0) > 0
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'kind', case block.block_kind when 'reservation' then 'reservation_overlap' else 'unavailability_overlap' end,
    'placementId', placement.id,
    'taskId', placement.task_id,
    'taskTitle', placement.title,
    'blockId', block.block_id,
    'blockTitle', block.title,
    'blockSource', block.source,
    'blockStartsAt', block.starts_at,
    'blockEndsAt', block.ends_at
  ) order by placement.planned_start_at, block.starts_at, placement.id, block.block_id), '[]'::jsonb)
  into v_block_conflicts
  from placements placement
  join atlas.member_day_capacity_blocks_v1(p_farm_id, p_membership_id, p_day) block
    on placement.span && tstzrange(block.starts_at, block.ends_at, '[)');

  v_interval_conflicts := v_pair_conflicts || v_block_conflicts;

  if v_full_day_unavailable and v_planned > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('worker_day_unavailable');
    v_conflict_codes := v_conflict_codes || jsonb_build_array('worker_day_unavailable');
  end if;
  if v_reservation_minutes > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_reduced_by_reservations');
  end if;
  if v_partial_unavailable_minutes > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_reduced_by_partial_unavailability');
  end if;
  if v_over_target > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_target_exceeded');
  end if;
  if v_over_maximum > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_maximum_exceeded');
    v_conflict_codes := v_conflict_codes || jsonb_build_array('day_capacity_maximum_exceeded');
  end if;
  if v_over_heavy > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('day_capacity_heavy_soft_cap_exceeded');
  end if;
  if jsonb_array_length(v_pair_conflicts) > 0 then
    v_warning_codes := v_warning_codes || jsonb_build_array('clock_task_interval_overlap');
    v_conflict_codes := v_conflict_codes || jsonb_build_array('clock_task_interval_overlap');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_block_conflicts) conflict
    where conflict->>'kind' = 'reservation_overlap'
  ) then
    v_warning_codes := v_warning_codes || jsonb_build_array('clock_interval_overlaps_reservation');
    v_conflict_codes := v_conflict_codes || jsonb_build_array('clock_interval_overlaps_reservation');
  end if;
  if exists (
    select 1 from jsonb_array_elements(v_block_conflicts) conflict
    where conflict->>'kind' = 'unavailability_overlap'
  ) then
    v_warning_codes := v_warning_codes || jsonb_build_array('clock_interval_overlaps_unavailability');
    v_conflict_codes := v_conflict_codes || jsonb_build_array('clock_interval_overlaps_unavailability');
  end if;

  return jsonb_build_object(
    'contractVersion', 'clock_day_capacity_v2',
    'serviceDate', p_day,
    'fullDayUnavailable', v_full_day_unavailable,
    'configuredPaidTargetMinutes', v_target,
    'configuredMaximumPlannedMinutes', v_maximum,
    'paidTargetMinutes', v_effective_target,
    'maximumPlannedMinutes', v_effective_maximum,
    'reservationMinutes', v_reservation_minutes,
    'partialUnavailableMinutes', v_partial_unavailable_minutes,
    'blockedMinutes', v_blocked_minutes,
    'plannedPaidMinutes', v_planned,
    'overTargetMinutes', v_over_target,
    'overMaximumMinutes', v_over_maximum,
    'heavyMinutesSoftCap', v_heavy_cap,
    'plannedHeavyMinutes', v_planned_heavy,
    'overHeavySoftCapMinutes', v_over_heavy,
    'placedTaskMinutes', v_placed_task_minutes,
    'timedPlacementMinutes', v_timed_placement_minutes,
    'intervalConflicts', v_interval_conflicts,
    'warningCodes', v_warning_codes,
    'conflictCodes', v_conflict_codes,
    'status', case
      when jsonb_array_length(v_conflict_codes) > 0 then 'conflict'
      when jsonb_array_length(v_warning_codes) > 0 then 'warning'
      else 'ok'
    end,
    'hasConflict', jsonb_array_length(v_conflict_codes) > 0
  );
end;
$function$;

revoke all on function atlas.clock_day_capacity_state_v2(uuid,uuid,date,integer,integer) from public, anon, authenticated;
grant execute on function atlas.clock_day_capacity_state_v2(uuid,uuid,date,integer,integer) to service_role;

create or replace function atlas.enrich_worker_day_plan_clock_capacity_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_day date,
  p_plan jsonb
)
returns jsonb
language plpgsql
stable
set search_path = pg_catalog, atlas
as $function$
declare
  v_item jsonb;
  v_real_work jsonb := '[]'::jsonb;
  v_task_id uuid;
  v_duration integer;
  v_physical_load text;
  v_committed integer := 0;
  v_heavy integer := 0;
  v_automatic integer := greatest(coalesce(nullif(p_plan->>'automaticPaidMinutes','')::integer, 0), 0);
  v_planned integer;
  v_target integer;
  v_capacity jsonb;
  v_warnings jsonb;
  v_conflicts jsonb;
begin
  if p_plan is null or jsonb_typeof(p_plan) <> 'object' then
    return p_plan;
  end if;

  for v_item in
    select value from jsonb_array_elements(coalesce(p_plan->'realWork', '[]'::jsonb))
  loop
    v_task_id := null;
    begin
      if nullif(v_item->>'taskId','') is not null then
        v_task_id := (v_item->>'taskId')::uuid;
      end if;
    exception when others then
      v_task_id := null;
    end;

    v_duration := greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer, 0), 0);
    v_physical_load := nullif(v_item->>'physicalLoad','');

    if v_task_id is not null then
      select p.planned_duration_minutes
      into v_duration
      from atlas.worker_day_task_placements p
      where p.farm_id = p_farm_id
        and p.membership_id = p_membership_id
        and p.task_id = v_task_id
        and p.service_date = p_day
        and p.state = 'placed'
        and p.planned_duration_minutes is not null
      limit 1;

      if not found then
        v_duration := greatest(coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer, 0), 0);
      end if;

      if v_physical_load is null then
        select cp.physical_load
        into v_physical_load
        from atlas.tasks t
        cross join lateral atlas.task_capacity_plan_v1(t, p_day) cp
        where t.id = v_task_id
        limit 1;
      end if;
    end if;

    v_item := jsonb_set(v_item, '{expectedActiveMinutes}', to_jsonb(v_duration), true);
    v_real_work := v_real_work || jsonb_build_array(v_item);
    v_committed := v_committed + v_duration;
    if v_physical_load = 'heavy' then
      v_heavy := v_heavy + v_duration;
    end if;
  end loop;

  v_planned := v_committed + v_automatic;
  v_capacity := atlas.clock_day_capacity_state_v2(p_farm_id, p_membership_id, p_day, v_planned, v_heavy);
  v_target := coalesce(nullif(v_capacity->>'paidTargetMinutes','')::integer, 420);

  select coalesce(jsonb_agg(to_jsonb(code) order by code), '[]'::jsonb)
  into v_warnings
  from (
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(p_plan->'warnings', '[]'::jsonb)) j
    union
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(v_capacity->'warningCodes', '[]'::jsonb)) j
  ) warnings;

  select coalesce(jsonb_agg(to_jsonb(code) order by code), '[]'::jsonb)
  into v_conflicts
  from (
    select distinct j.value #>> '{}' as code
    from jsonb_array_elements(coalesce(v_capacity->'conflictCodes', '[]'::jsonb)) j
  ) conflicts;

  return p_plan || jsonb_build_object(
    'realWork', v_real_work,
    'paidTargetMinutes', v_target,
    'committedPaidMinutes', v_committed,
    'automaticPaidMinutes', v_automatic,
    'remainingPaidMinutes', greatest(v_target - v_planned, 0),
    'clockCapacity', v_capacity,
    'warnings', v_warnings,
    'conflicts', v_conflicts
  );
end;
$function$;