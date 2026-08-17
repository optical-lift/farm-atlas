create or replace function atlas.principal_clock_arbitration_v1(
  p_principal_id uuid,
  p_day date,
  p_as_of timestamptz default now()
)
returns table (
  arbitration_rank bigint,
  timing_tier smallint,
  timing_state text,
  why_now text,
  right_to_floor_now boolean,
  latest_start_at timestamptz,
  next_boundary_at timestamptz,
  placement_state text,
  individually_within_daily_plan boolean,
  capacity_state text,
  capacity_known boolean,
  maximum_planned_minutes integer,
  discretionary_capacity_minutes integer,
  principal_id uuid,
  domain text,
  source_type text,
  source_id uuid,
  title text,
  floor_class smallint,
  window_start timestamptz,
  window_end timestamptz,
  fixed_start timestamptz,
  must_begin_by timestamptz,
  must_finish_by timestamptz,
  expected_minutes integer,
  protection_level text,
  interruptibility text,
  delegable boolean,
  owner_required boolean,
  consequence text,
  reason_for_floor text,
  portfolio_unit_id uuid,
  horizon text,
  metadata jsonb
)
language sql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
with capacity as (
  select atlas.principal_capacity_day_state_v1(p_principal_id, p_day) as state
), base as (
  select
    c.*,
    coalesce(c.must_finish_by, c.window_end) as finish_boundary,
    case
      when c.expected_minutes is not null
       and c.expected_minutes > 0
       and coalesce(c.must_finish_by, c.window_end) is not null
      then coalesce(c.must_finish_by, c.window_end) - make_interval(mins => c.expected_minutes)
      else null
    end as derived_latest_start_at
  from atlas.principal_clock_candidates_v1 c
  where c.principal_id = p_principal_id
), classified as (
  select
    b.*,
    case
      when b.fixed_start is not null
       and b.fixed_start <= p_as_of
       and b.window_end is not null
       and p_as_of < b.window_end
        then 0
      when b.fixed_start is null
       and b.must_finish_by is not null
       and b.must_finish_by <= p_as_of
        then 10
      when b.fixed_start is null
       and b.must_finish_by is null
       and b.window_end is not null
       and b.window_end <= p_as_of
        then 11
      when b.fixed_start is not null
       and b.window_end is null
       and b.fixed_start <= p_as_of
        then 12
      when b.fixed_start is null
       and b.must_begin_by is not null
       and b.must_begin_by <= p_as_of
       and (b.finish_boundary is null or p_as_of < b.finish_boundary)
        then 20
      when b.fixed_start is null
       and b.derived_latest_start_at is not null
       and b.derived_latest_start_at <= p_as_of
       and b.finish_boundary is not null
       and p_as_of < b.finish_boundary
        then 21
      when b.fixed_start is null
       and (b.window_start is null or b.window_start <= p_as_of)
       and (b.window_end is null or p_as_of < b.window_end)
        then 30
      when b.fixed_start is not null
       and b.fixed_start > p_as_of
        then 50
      when b.fixed_start is not null
       and b.window_end is not null
       and b.window_end <= p_as_of
        then 90
      when b.window_start is not null
       and b.window_start > p_as_of
        then 60
      else 70
    end::smallint as derived_timing_tier,
    case
      when b.fixed_start is not null
       and b.fixed_start <= p_as_of
       and b.window_end is not null
       and p_as_of < b.window_end
        then 'fixed_active'
      when b.fixed_start is null
       and b.must_finish_by is not null
       and b.must_finish_by <= p_as_of
        then 'finish_boundary_breached'
      when b.fixed_start is null
       and b.must_finish_by is null
       and b.window_end is not null
       and b.window_end <= p_as_of
        then 'window_elapsed_unresolved'
      when b.fixed_start is not null
       and b.window_end is null
       and b.fixed_start <= p_as_of
        then 'fixed_point_reached'
      when b.fixed_start is null
       and b.must_begin_by is not null
       and b.must_begin_by <= p_as_of
       and (b.finish_boundary is null or p_as_of < b.finish_boundary)
        then 'must_begin_boundary_reached'
      when b.fixed_start is null
       and b.derived_latest_start_at is not null
       and b.derived_latest_start_at <= p_as_of
       and b.finish_boundary is not null
       and p_as_of < b.finish_boundary
        then 'latest_start_reached'
      when b.fixed_start is null
       and (b.window_start is null or b.window_start <= p_as_of)
       and (b.window_end is null or p_as_of < b.window_end)
        then 'relevant_window_open'
      when b.fixed_start is not null
       and b.fixed_start > p_as_of
        then 'fixed_upcoming'
      when b.fixed_start is not null
       and b.window_end is not null
       and b.window_end <= p_as_of
        then 'fixed_elapsed'
      when b.window_start is not null
       and b.window_start > p_as_of
        then 'future_window'
      else 'remembered_without_current_timing'
    end as derived_timing_state,
    (
      select min(x.boundary)
      from (values
        (b.fixed_start),
        (b.window_start),
        (b.must_begin_by),
        (b.derived_latest_start_at),
        (b.must_finish_by),
        (b.window_end)
      ) as x(boundary)
      where x.boundary > p_as_of
    ) as derived_next_boundary_at
  from base b
), enriched as (
  select
    c.*,
    case c.derived_timing_state
      when 'fixed_active' then 'A fixed commitment is in progress.'
      when 'finish_boundary_breached' then 'Its finish boundary has passed while the claim remains open.'
      when 'window_elapsed_unresolved' then 'Its relevant window has elapsed while the claim remains unresolved.'
      when 'fixed_point_reached' then 'Its fixed point has been reached while the claim remains open.'
      when 'must_begin_boundary_reached' then 'Its must-begin boundary has been reached.'
      when 'latest_start_reached' then 'Its latest start has been reached after accounting for expected duration.'
      when 'relevant_window_open' then 'Its relevant window is open.'
      when 'fixed_upcoming' then 'A fixed commitment is upcoming.'
      when 'future_window' then 'Its relevant window has not opened yet.'
      when 'fixed_elapsed' then 'The fixed commitment time window has elapsed.'
      else 'The claim is remembered, but no current timing boundary gives it the floor.'
    end as derived_why_now,
    case c.protection_level
      when 'critical' then 0
      when 'protected' then 1
      when 'standard' then 2
      when 'optional' then 3
      else 4
    end as protection_order
  from classified c
), ranked as (
  select
    e.*,
    row_number() over (
      order by
        e.derived_timing_tier,
        e.floor_class,
        e.protection_order,
        e.derived_next_boundary_at nulls last,
        e.title,
        e.source_id
    ) as derived_arbitration_rank
  from enriched e
), cap as (
  select
    state,
    state ->> 'state' as capacity_state,
    coalesce((state ->> 'capacityKnown')::boolean, false) as capacity_known,
    nullif(state ->> 'maximumPlannedMinutes','')::integer as maximum_planned_minutes,
    nullif(state ->> 'discretionaryCapacityMinutes','')::integer as discretionary_capacity_minutes
  from capacity
)
select
  r.derived_arbitration_rank as arbitration_rank,
  r.derived_timing_tier as timing_tier,
  r.derived_timing_state as timing_state,
  r.derived_why_now as why_now,
  (r.derived_timing_tier <= 30) as right_to_floor_now,
  r.derived_latest_start_at as latest_start_at,
  r.derived_next_boundary_at as next_boundary_at,
  case
    when r.fixed_start is not null or r.source_type = 'capacity_block' then 'fixed_or_precommitted'
    when not cap.capacity_known then 'capacity_anchor_required'
    when r.expected_minutes is null then 'duration_required'
    when cap.maximum_planned_minutes is null then 'capacity_anchor_required'
    when r.expected_minutes <= cap.maximum_planned_minutes then 'eligible_for_placement'
    else 'exceeds_daily_planning_capacity'
  end as placement_state,
  case
    when r.fixed_start is not null or r.source_type = 'capacity_block' then null::boolean
    when not cap.capacity_known then false
    when r.expected_minutes is null or cap.maximum_planned_minutes is null then false
    else r.expected_minutes <= cap.maximum_planned_minutes
  end as individually_within_daily_plan,
  cap.capacity_state,
  cap.capacity_known,
  cap.maximum_planned_minutes,
  cap.discretionary_capacity_minutes,
  r.principal_id,
  r.domain,
  r.source_type,
  r.source_id,
  r.title,
  r.floor_class,
  r.window_start,
  r.window_end,
  r.fixed_start,
  r.must_begin_by,
  r.must_finish_by,
  r.expected_minutes,
  r.protection_level,
  r.interruptibility,
  r.delegable,
  r.owner_required,
  r.consequence,
  r.reason_for_floor,
  r.portfolio_unit_id,
  r.horizon,
  r.metadata
from ranked r
cross join cap
order by r.derived_arbitration_rank;
$function$;

revoke all on function atlas.principal_clock_arbitration_v1(uuid,date,timestamptz) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_clock_arbitration_v1(uuid,date,timestamptz) to postgres;

create or replace function atlas.principal_clock_api_v1(
  p_day date default current_date,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_principal_id uuid;
  v_capacity jsonb;
  v_candidates jsonb;
  v_floor jsonb;
begin
  if p_day is null then
    raise exception 'A Principal Clock date is required.' using errcode='22023';
  end if;
  if p_as_of is null then
    raise exception 'A Principal Clock as-of time is required.' using errcode='22023';
  end if;

  v_principal_id := atlas.require_current_principal_id_v1();
  v_capacity := atlas.principal_capacity_day_state_v1(v_principal_id, p_day);

  select coalesce(jsonb_agg(to_jsonb(a) order by a.arbitration_rank), '[]'::jsonb)
  into v_candidates
  from atlas.principal_clock_arbitration_v1(v_principal_id, p_day, p_as_of) a;

  select to_jsonb(a)
  into v_floor
  from atlas.principal_clock_arbitration_v1(v_principal_id, p_day, p_as_of) a
  where a.right_to_floor_now
    and a.timing_state <> 'fixed_elapsed'
  order by a.arbitration_rank
  limit 1;

  return jsonb_build_object(
    'contractVersion', 'principal_clock_api_v1',
    'principalId', v_principal_id,
    'serviceDate', p_day,
    'asOf', p_as_of,
    'allocationState', 'read_only_arbitration',
    'capacity', v_capacity,
    'floor', v_floor,
    'candidates', v_candidates
  );
end;
$function$;

revoke all on function atlas.principal_clock_api_v1(date,timestamptz) from public, anon, authenticated, service_role;
grant execute on function atlas.principal_clock_api_v1(date,timestamptz) to authenticated, service_role, postgres;

comment on function atlas.principal_clock_arbitration_v1(uuid,date,timestamptz) is
'Principal Clock v1 arbitration over normalized Principal claims. Timing state is derived from recorded boundaries and expected duration; floor_class is a tie-break within timing state, not a standalone priority. Read-only; does not allocate time.';

comment on function atlas.principal_clock_api_v1(date,timestamptz) is
'Authenticated Principal Clock v1 read contract. Returns capacity state, explainable arbitration, and the current floor claim without creating or allocating work.';