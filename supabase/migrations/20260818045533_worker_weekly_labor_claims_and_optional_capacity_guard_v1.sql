create or replace function atlas.worker_weekly_labor_claims_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_week jsonb;
  v_capacity jsonb;
  v_week_start date;
  v_week_end date;
  v_required_claims jsonb:='[]'::jsonb;
  v_placed_claims jsonb:='[]'::jsonb;
  v_human_claims jsonb:='[]'::jsonb;
  v_required_minutes integer:=0;
  v_protected_minutes integer:=0;
  v_placed_required_minutes integer:=0;
  v_placed_optional_minutes integer:=0;
  v_planned_capacity integer;
  v_recovery_capacity integer;
  v_remaining_optional integer;
  v_required_recovery_need integer;
  v_required_missing_including_recovery integer;
  v_unplaced_required integer;
begin
  v_week:=atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_week->>'weekStart')::date;
  v_week_end:=(v_week->>'weekEnd')::date;
  v_capacity:=atlas.worker_capacity_window_v1(p_farm_id,p_membership_id,v_week_start,v_week_end);

  with work as (
    select value item
    from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb))
  ), normalized as (
    select
      (item->>'taskId')::uuid task_id,
      item->>'title' title,
      coalesce((item->>'requiredThisWeek')::boolean,false) required_this_week,
      coalesce((item->>'protectedFarmMinimum')::boolean,false) protected_minimum,
      coalesce(nullif(item->>'expectedActiveMinutes','')::integer,0) estimated_minutes,
      item->>'effectiveConsequenceClass' consequence_class,
      nullif(item->>'effectiveConsequenceTier','')::integer consequence_tier,
      item->>'dueDate' due_date,
      coalesce((item->>'executionReady')::boolean,false) execution_ready
    from work
    where coalesce(item->>'taskId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), placed as (
    select
      p.task_id,p.service_date,p.planned_start_at,p.placement_source,p.placement_reason,
      coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)::integer placed_minutes
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
    where p.farm_id=p_farm_id and p.membership_id=p_membership_id
      and p.service_date between v_week_start and v_week_end
      and p.state='placed' and t.status in ('open','blocked')
  ), required as (
    select n.*,p.service_date,p.planned_start_at,p.placement_source,p.placement_reason,p.placed_minutes,
      greatest(n.estimated_minutes,coalesce(p.placed_minutes,0))::integer claim_minutes
    from normalized n
    left join placed p on p.task_id=n.task_id
    where n.required_this_week
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'claimSource','weekly_farm_contract',
      'claimSubject',task_id,
      'title',title,
      'claimedMinutes',claim_minutes,
      'unit','minutes',
      'requiredBy',due_date,
      'claimStrength',case when protected_minimum then 'protected' else 'committed' end,
      'displacementAuthority',case when protected_minimum then 'management' else 'farm_operations' end,
      'protectionReason',case when protected_minimum then 'protected farm minimum required by Weekly Farm Contract' else 'required weekly farm work' end,
      'status',case when service_date is null then 'required_unplaced' else 'required_placed' end,
      'executionReady',execution_ready,
      'consequenceClass',consequence_class,
      'consequenceTier',consequence_tier,
      'serviceDate',service_date,
      'plannedStartAt',planned_start_at,
      'sourceEvidence',jsonb_strip_nulls(jsonb_build_object(
        'estimatedMinutes',estimated_minutes,
        'placedMinutes',placed_minutes,
        'placementSource',placement_source,
        'placementReason',placement_reason
      ))
    )) order by protected_minimum desc,due_date nulls last,title),'[]'::jsonb),
    coalesce(sum(claim_minutes),0)::integer,
    coalesce(sum(claim_minutes) filter(where protected_minimum),0)::integer,
    coalesce(sum(coalesce(placed_minutes,0)),0)::integer
  into v_required_claims,v_required_minutes,v_protected_minutes,v_placed_required_minutes
  from required;

  with work as (
    select value item from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb))
  ), flags as (
    select (item->>'taskId')::uuid task_id,
      coalesce((item->>'requiredThisWeek')::boolean,false) required_this_week,
      coalesce((item->>'protectedFarmMinimum')::boolean,false) protected_minimum,
      item->>'title' title
    from work
    where coalesce(item->>'taskId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), placed as (
    select p.id placement_id,p.task_id,p.service_date,p.planned_start_at,p.placement_source,p.placement_reason,
      coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)::integer placed_minutes,
      coalesce(f.required_this_week,false) required_this_week,
      coalesce(f.protected_minimum,false) protected_minimum,
      coalesce(f.title,t.title) title
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
    left join flags f on f.task_id=p.task_id
    where p.farm_id=p_farm_id and p.membership_id=p_membership_id
      and p.service_date between v_week_start and v_week_end
      and p.state='placed' and t.status in ('open','blocked')
  )
  select
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'claimSource','worker_day_placement',
      'claimSubject',task_id,
      'placementId',placement_id,
      'title',title,
      'claimedMinutes',placed_minutes,
      'unit','minutes',
      'serviceDate',service_date,
      'plannedStartAt',planned_start_at,
      'claimStrength',case when protected_minimum then 'protected' when required_this_week then 'committed' else 'planned' end,
      'displacementAuthority',case when protected_minimum then 'management' when required_this_week then 'farm_operations' else 'farm_operations' end,
      'protectionReason',case when protected_minimum then 'protected farm minimum' when required_this_week then 'required weekly work' else 'explicitly placed optional work' end,
      'status','placed',
      'requiredThisWeek',required_this_week,
      'protectedFarmMinimum',protected_minimum,
      'sourceEvidence',jsonb_build_object('placementSource',placement_source,'placementReason',placement_reason)
    )) order by service_date,planned_start_at nulls last,title),'[]'::jsonb),
    coalesce(sum(placed_minutes) filter(where not required_this_week),0)::integer
  into v_placed_claims,v_placed_optional_minutes
  from placed;

  with days as (
    select value d from jsonb_array_elements(coalesce(v_capacity->'days','[]'::jsonb))
  ), reservations as (
    select d->>'serviceDate' service_date,r
    from days
    cross join lateral jsonb_array_elements(coalesce(d#>'{humanTime,reservations}','[]'::jsonb)) r
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'claimSource',coalesce(r->>'source',r#>>'{metadata,sourceKind}','human_time'),
    'claimSubject',r->>'reservationId',
    'title',r->>'title',
    'claimedMinutes',nullif(r->>'durationMinutes','')::integer,
    'unit','minutes',
    'serviceDate',service_date,
    'startsAt',r->>'startsAt',
    'endsAt',r->>'endsAt',
    'claimStrength',case when r->>'kind' in ('full_day_unavailability','partial_unavailability','external_commitment') then 'fixed' else 'protected' end,
    'displacementAuthority',case when r->>'kind' in ('full_day_unavailability','partial_unavailability','external_commitment') then 'explicit_cancellation_only' else 'management' end,
    'protectionReason',case when r->>'kind' in ('full_day_unavailability','partial_unavailability') then 'recorded worker unavailability' when r->>'kind'='external_commitment' then 'fixed external commitment' else 'protected human-time rhythm' end,
    'status','capacity_source_reduced',
    'capacityBlocking',r->'capacityBlocking',
    'sourceEvidence',r->'metadata'
  )) order by service_date,r->>'startsAt',r->>'title'),'[]'::jsonb)
  into v_human_claims
  from reservations;

  if coalesce((v_capacity->>'capacityKnown')::boolean,false) then
    v_planned_capacity:=coalesce((v_capacity->>'plannedCapacityMinutes')::integer,0);
    v_recovery_capacity:=coalesce((v_capacity->>'recoveryCapacityMinutes')::integer,0);
    v_remaining_optional:=greatest(v_planned_capacity-v_required_minutes-v_placed_optional_minutes,0);
    v_required_recovery_need:=greatest(v_required_minutes-v_planned_capacity,0);
    v_required_missing_including_recovery:=greatest(v_required_minutes-v_planned_capacity-v_recovery_capacity,0);
  end if;
  v_unplaced_required:=greatest(v_required_minutes-v_placed_required_minutes,0);

  return jsonb_build_object(
    'contractVersion','worker_weekly_labor_claims_v1',
    'farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,
    'capacity',jsonb_build_object(
      'capacityKnown',coalesce((v_capacity->>'capacityKnown')::boolean,false),
      'plannedCapacityMinutes',v_planned_capacity,
      'recoveryCapacityMinutes',v_recovery_capacity,
      'placementBasedRemainingPlannedMinutes',v_capacity->'remainingPlannedMinutes',
      'humanTimeReservationCount',v_capacity->'humanTimeReservationCount',
      'humanTimeAlreadyReducesSourceCapacity',true
    ),
    'claims',jsonb_build_object(
      'humanTime',v_human_claims,
      'requiredWeeklyWork',v_required_claims,
      'placedWork',v_placed_claims
    ),
    'totals',jsonb_build_object(
      'requiredClaimMinutes',v_required_minutes,
      'protectedRequiredClaimMinutes',v_protected_minutes,
      'placedRequiredMinutes',v_placed_required_minutes,
      'unplacedRequiredClaimMinutes',v_unplaced_required,
      'placedOptionalClaimMinutes',v_placed_optional_minutes,
      'remainingOptionalPlannedAvailabilityMinutes',v_remaining_optional,
      'requiredRecoveryNeedMinutes',v_required_recovery_need,
      'requiredMissingIncludingRecoveryMinutes',v_required_missing_including_recovery
    ),
    'truthBoundary',jsonb_build_object(
      'estimatedMinutesAreCapacityClaimsNotLaborActuals',true,
      'humanReservationsReduceSourceCapacityAndAreNotSubtractedTwice',true,
      'placedTaskIsTimeClaimNotTaskFruit',true,
      'unplacedOptionalWorkIsCandidateNotClaim',true,
      'optionalWorkCannotUseRecoveryToAppearNormallyAvailable',true,
      'protectedAndRequiredClaimsPrecedeOptionalAvailability',true
    )
  );
end;
$$;

revoke all on function atlas.worker_weekly_labor_claims_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_labor_claims_v1(uuid,uuid,date) to service_role;

create or replace function atlas.worker_optional_placement_warrant_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_prospective_minutes integer default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_week jsonb;
  v_item jsonb;
  v_claims jsonb;
  v_required boolean:=false;
  v_protected boolean:=false;
  v_requested integer:=0;
  v_existing atlas.worker_day_task_placements%rowtype;
  v_existing_minutes integer:=0;
  v_week_available integer:=0;
  v_day_capacity jsonb;
  v_day_available integer:=0;
  v_other_day_placed integer:=0;
  v_role text;
  v_allowed boolean:=false;
  v_reason text;
begin
  if p_service_date is null then raise exception 'A service date is required.' using errcode='22023'; end if;
  select fm.role into v_role from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true;
  if v_role is null then raise exception 'Active worker membership required.' using errcode='P0002'; end if;
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is null then raise exception 'Task not found on this farm.' using errcode='P0002'; end if;

  v_week:=atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_service_date);
  select value into v_item from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb))
  where value->>'taskId'=p_task_id::text limit 1;
  v_required:=coalesce((v_item->>'requiredThisWeek')::boolean,false);
  v_protected:=coalesce((v_item->>'protectedFarmMinimum')::boolean,false);

  if p_prospective_minutes is not null then v_requested:=greatest(p_prospective_minutes,0);
  else
    select coalesce(cp.expected_active_minutes,0)::integer into v_requested
    from atlas.task_capacity_plan_v1(v_task,p_service_date) cp;
  end if;

  if v_required or v_protected then
    return jsonb_build_object(
      'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
      'workClass',case when v_protected then 'protected_required' else 'required' end,
      'requestedMinutes',v_requested,'allowed',true,
      'reason','Required/protected work may acquire capacity; any resulting over-capacity remains a Farm Operations management conflict rather than an optional-placement rejection.',
      'principalEscalationWarrant',false
    );
  end if;

  v_claims:=atlas.worker_weekly_labor_claims_v1(p_farm_id,p_membership_id,p_service_date);
  v_week_available:=coalesce((v_claims#>>'{totals,remainingOptionalPlannedAvailabilityMinutes}')::integer,0);

  select * into v_existing from atlas.worker_day_task_placements where task_id=p_task_id;
  if v_existing.id is not null and v_existing.state='placed'
     and v_existing.service_date between (v_claims->>'weekStart')::date and (v_claims->>'weekEnd')::date then
    select coalesce(v_existing.planned_duration_minutes,cp.expected_active_minutes,0)::integer into v_existing_minutes
    from atlas.task_capacity_plan_v1(v_task,v_existing.service_date) cp;
    v_week_available:=v_week_available+v_existing_minutes;
  end if;

  v_day_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_service_date);
  if not coalesce((v_day_capacity->>'capacityKnown')::boolean,false) then
    return jsonb_build_object(
      'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
      'workClass','optional','requestedMinutes',v_requested,'allowed',false,'reason','Worker day capacity is not known for the requested date.',
      'capacityState',v_day_capacity->>'state','principalEscalationWarrant',false
    );
  end if;

  select coalesce(sum(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)),0)::integer
  into v_other_day_placed
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=p_service_date
    and p.state='placed' and t.status in ('open','blocked') and p.task_id<>p_task_id;

  v_day_available:=greatest(coalesce((v_day_capacity->>'plannedCapacityMinutes')::integer,0)-v_other_day_placed,0);
  v_allowed:=v_requested<=v_week_available and v_requested<=v_day_available;
  v_reason:=case
    when v_requested>v_week_available then 'Optional work would consume weekly capacity already claimed by required/protected work.'
    when v_requested>v_day_available then 'Optional work does not fit inside the requested day after human-time and existing placement claims.'
    else 'Optional work fits inside capacity remaining after required/protected weekly claims.'
  end;

  return jsonb_build_object(
    'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
    'workClass','optional','requestedMinutes',v_requested,'allowed',v_allowed,'reason',v_reason,
    'weeklyOptionalAvailableMinutes',v_week_available,'dayOptionalAvailableMinutes',v_day_available,
    'existingPlacementMinutesAddedBack',v_existing_minutes,'principalEscalationWarrant',false,
    'truthBoundary',jsonb_build_object('optionalCandidateIsNotClaimUntilPlaced',true,'recoveryCapacityDoesNotAuthorizeNormalOptionalPlacement',true)
  );
end;
$$;

revoke all on function atlas.worker_optional_placement_warrant_v1(uuid,uuid,uuid,date,integer) from public,anon,authenticated;
grant execute on function atlas.worker_optional_placement_warrant_v1(uuid,uuid,uuid,date,integer) to service_role;

create or replace function atlas.validate_worker_day_optional_capacity_claim_v1()
returns trigger
language plpgsql
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_role text;
  v_warrant jsonb;
begin
  if new.state<>'placed' then return new; end if;
  if tg_op='UPDATE' and new.state is not distinct from old.state
     and new.service_date is not distinct from old.service_date
     and new.planned_duration_minutes is not distinct from old.planned_duration_minutes
     and new.task_id is not distinct from old.task_id
     and new.membership_id is not distinct from old.membership_id then
    return new;
  end if;

  select fm.role into v_role from atlas.farm_memberships fm
  where fm.id=new.membership_id and fm.farm_id=new.farm_id and fm.active=true;
  if v_role is distinct from 'farm_hand' then return new; end if;

  v_warrant:=atlas.worker_optional_placement_warrant_v1(
    new.farm_id,new.membership_id,new.task_id,new.service_date,new.planned_duration_minutes
  );
  if not coalesce((v_warrant->>'allowed')::boolean,false) then
    raise exception '%',coalesce(v_warrant->>'reason','Optional Worker Day work cannot displace required/protected capacity.') using errcode='55000';
  end if;
  return new;
end;
$$;

drop trigger if exists worker_day_task_placements_optional_capacity_claim_v1 on atlas.worker_day_task_placements;
create trigger worker_day_task_placements_optional_capacity_claim_v1
before insert or update on atlas.worker_day_task_placements
for each row execute function atlas.validate_worker_day_optional_capacity_claim_v1();
