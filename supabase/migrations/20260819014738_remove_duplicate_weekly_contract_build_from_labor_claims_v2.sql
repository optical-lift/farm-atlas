create or replace function atlas.worker_weekly_labor_claims_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_base jsonb;
  v_week_start date;
  v_week_end date;
  v_required_heavy integer:=0;
  v_placed_optional_heavy integer:=0;
  v_planned_heavy_cap integer:=0;
  v_total_heavy_cap integer:=0;
  v_remaining_optional_heavy integer;
  v_required_heavy_recovery_need integer;
  v_required_heavy_missing integer;
  v_capacity_known boolean:=false;
begin
  v_base:=atlas.worker_weekly_labor_claims_v1(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_base->>'weekStart')::date;
  v_week_end:=(v_base->>'weekEnd')::date;
  v_capacity_known:=coalesce((v_base#>>'{capacity,capacityKnown}')::boolean,false);

  with required_claims as (
    select
      (claim->>'claimSubject')::uuid task_id,
      greatest(coalesce((claim->>'claimedMinutes')::integer,0),0) claimed_minutes,
      nullif(claim->>'serviceDate','')::date service_date
    from jsonb_array_elements(coalesce(v_base#>'{claims,requiredWeeklyWork}','[]'::jsonb)) claim
    where coalesce(claim->>'claimSubject','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select coalesce(sum(r.claimed_minutes) filter(where cp.physical_load='heavy'),0)::integer
  into v_required_heavy
  from required_claims r
  join atlas.tasks t on t.id=r.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,coalesce(r.service_date,v_week_start)) cp;

  with placed_optional as (
    select
      (claim->>'claimSubject')::uuid task_id,
      greatest(coalesce((claim->>'claimedMinutes')::integer,0),0) claimed_minutes,
      nullif(claim->>'serviceDate','')::date service_date
    from jsonb_array_elements(coalesce(v_base#>'{claims,placedWork}','[]'::jsonb)) claim
    where coalesce((claim->>'requiredThisWeek')::boolean,false)=false
      and coalesce(claim->>'claimSubject','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  )
  select coalesce(sum(p.claimed_minutes) filter(where cp.physical_load='heavy'),0)::integer
  into v_placed_optional_heavy
  from placed_optional p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,coalesce(p.service_date,v_week_start)) cp;

  with days as (
    select d::date service_date
    from generate_series(v_week_start,v_week_end,interval '1 day') d
  ), capacities as (
    select d.service_date,atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,d.service_date) c
    from days d
  )
  select
    coalesce(sum(case when c->>'capacityClass'='planned' then coalesce((c->>'heavyMinutesSoftCap')::integer,0) else 0 end),0)::integer,
    coalesce(sum(coalesce((c->>'heavyMinutesSoftCap')::integer,0)),0)::integer
  into v_planned_heavy_cap,v_total_heavy_cap
  from capacities;

  if v_capacity_known then
    v_remaining_optional_heavy:=greatest(v_planned_heavy_cap-v_required_heavy-v_placed_optional_heavy,0);
    v_required_heavy_recovery_need:=greatest(v_required_heavy-v_planned_heavy_cap,0);
    v_required_heavy_missing:=greatest(v_required_heavy-v_total_heavy_cap,0);
  end if;

  return v_base
    || jsonb_build_object('contractVersion','worker_weekly_labor_claims_v2')
    || jsonb_build_object(
      'capacity',coalesce(v_base->'capacity','{}'::jsonb)||jsonb_build_object(
        'plannedHeavyMinutesSoftCap',v_planned_heavy_cap,
        'totalHeavyMinutesSoftCapIncludingRecovery',v_total_heavy_cap
      ),
      'totals',coalesce(v_base->'totals','{}'::jsonb)||jsonb_build_object(
        'requiredHeavyClaimMinutes',v_required_heavy,
        'placedOptionalHeavyClaimMinutes',v_placed_optional_heavy,
        'remainingOptionalHeavyAvailabilityMinutes',v_remaining_optional_heavy,
        'requiredHeavyRecoveryNeedMinutes',v_required_heavy_recovery_need,
        'requiredHeavyMissingIncludingRecoveryMinutes',v_required_heavy_missing
      ),
      'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
        'physicalLoadCapacityIsClaimedSeparatelyFromTotalMinutes',true,
        'optionalHeavyWorkCannotConsumeHeavyCapacityReservedForRequiredWork',true,
        'weeklyFarmContractIsBuiltOncePerLaborClaimEvaluation',true
      )
    );
end;
$function$;