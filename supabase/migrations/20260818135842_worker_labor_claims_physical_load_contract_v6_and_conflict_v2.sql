create or replace function atlas.worker_weekly_labor_claims_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_base jsonb;
  v_week jsonb;
  v_capacity jsonb;
  v_week_start date;
  v_week_end date;
  v_required_heavy integer:=0;
  v_placed_optional_heavy integer:=0;
  v_planned_heavy_cap integer:=0;
  v_total_heavy_cap integer:=0;
  v_remaining_optional_heavy integer;
  v_required_heavy_recovery_need integer;
  v_required_heavy_missing integer;
begin
  v_base:=atlas.worker_weekly_labor_claims_v1(p_farm_id,p_membership_id,p_anchor_day);
  v_week_start:=(v_base->>'weekStart')::date;
  v_week_end:=(v_base->>'weekEnd')::date;
  v_week:=atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,v_week_start);
  v_capacity:=atlas.worker_capacity_window_v1(p_farm_id,p_membership_id,v_week_start,v_week_end);

  with work as (
    select value item from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb))
  ), normalized as (
    select
      (item->>'taskId')::uuid task_id,
      coalesce((item->>'requiredThisWeek')::boolean,false) required_this_week,
      item->>'physicalLoad' physical_load,
      coalesce(nullif(item->>'expectedActiveMinutes','')::integer,0) estimated_minutes
    from work
    where coalesce(item->>'taskId','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ), placed as (
    select p.task_id,
      coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)::integer placed_minutes,
      cp.physical_load
    from atlas.worker_day_task_placements p
    join atlas.tasks t on t.id=p.task_id
    cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
    where p.farm_id=p_farm_id and p.membership_id=p_membership_id
      and p.service_date between v_week_start and v_week_end
      and p.state='placed' and t.status in ('open','blocked')
  )
  select
    coalesce(sum(greatest(n.estimated_minutes,coalesce(p.placed_minutes,0))) filter(where n.required_this_week and coalesce(n.physical_load,p.physical_load)='heavy'),0)::integer,
    coalesce(sum(p.placed_minutes) filter(where not coalesce(n.required_this_week,false) and p.physical_load='heavy'),0)::integer
  into v_required_heavy,v_placed_optional_heavy
  from normalized n
  full join placed p on p.task_id=n.task_id;

  select
    coalesce(sum(case when d#>>'{capacity,capacityClass}'='planned' then coalesce((d#>>'{capacity,heavyMinutesSoftCap}')::integer,0) else 0 end),0)::integer,
    coalesce(sum(coalesce((d#>>'{capacity,heavyMinutesSoftCap}')::integer,0)),0)::integer
  into v_planned_heavy_cap,v_total_heavy_cap
  from jsonb_array_elements(coalesce(v_capacity->'days','[]'::jsonb)) d;

  if coalesce((v_capacity->>'capacityKnown')::boolean,false) then
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
        'optionalHeavyWorkCannotConsumeHeavyCapacityReservedForRequiredWork',true
      )
    );
end;
$$;

revoke all on function atlas.worker_weekly_labor_claims_v2(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_labor_claims_v2(uuid,uuid,date) to service_role;

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
  v_week_heavy_available integer:=0;
  v_day_capacity jsonb;
  v_day_available integer:=0;
  v_day_heavy_available integer:=0;
  v_other_day_placed integer:=0;
  v_other_day_heavy integer:=0;
  v_role text;
  v_physical_load text;
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

  select cp.physical_load,coalesce(cp.expected_active_minutes,0)::integer
    into v_physical_load,v_requested
  from atlas.task_capacity_plan_v1(v_task,p_service_date) cp;
  if p_prospective_minutes is not null then v_requested:=greatest(p_prospective_minutes,0); end if;

  if v_required or v_protected then
    return jsonb_build_object(
      'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
      'workClass',case when v_protected then 'protected_required' else 'required' end,
      'physicalLoad',v_physical_load,'requestedMinutes',v_requested,'allowed',true,
      'reason','Required/protected work may acquire capacity; any resulting over-capacity remains a Farm Operations management conflict rather than an optional-placement rejection.',
      'principalEscalationWarrant',false
    );
  end if;

  v_claims:=atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,p_service_date);
  v_week_available:=coalesce((v_claims#>>'{totals,remainingOptionalPlannedAvailabilityMinutes}')::integer,0);
  v_week_heavy_available:=coalesce((v_claims#>>'{totals,remainingOptionalHeavyAvailabilityMinutes}')::integer,0);

  select * into v_existing from atlas.worker_day_task_placements where task_id=p_task_id;
  if v_existing.id is not null and v_existing.state='placed'
     and v_existing.service_date between (v_claims->>'weekStart')::date and (v_claims->>'weekEnd')::date then
    select coalesce(v_existing.planned_duration_minutes,cp.expected_active_minutes,0)::integer into v_existing_minutes
    from atlas.task_capacity_plan_v1(v_task,v_existing.service_date) cp;
    v_week_available:=v_week_available+v_existing_minutes;
    if v_physical_load='heavy' then v_week_heavy_available:=v_week_heavy_available+v_existing_minutes; end if;
  end if;

  v_day_capacity:=atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_service_date);
  if not coalesce((v_day_capacity->>'capacityKnown')::boolean,false) then
    return jsonb_build_object(
      'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
      'workClass','optional','physicalLoad',v_physical_load,'requestedMinutes',v_requested,'allowed',false,
      'reason','Worker day capacity is not known for the requested date.','capacityState',v_day_capacity->>'state',
      'principalEscalationWarrant',false
    );
  end if;

  select
    coalesce(sum(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)),0)::integer,
    coalesce(sum(coalesce(p.planned_duration_minutes,cp.expected_active_minutes,0)) filter(where cp.physical_load='heavy'),0)::integer
  into v_other_day_placed,v_other_day_heavy
  from atlas.worker_day_task_placements p
  join atlas.tasks t on t.id=p.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,p.service_date) cp
  where p.farm_id=p_farm_id and p.membership_id=p_membership_id and p.service_date=p_service_date
    and p.state='placed' and t.status in ('open','blocked') and p.task_id<>p_task_id;

  v_day_available:=greatest(coalesce((v_day_capacity->>'plannedCapacityMinutes')::integer,0)-v_other_day_placed,0);
  v_day_heavy_available:=greatest(coalesce((v_day_capacity->>'heavyMinutesSoftCap')::integer,0)-v_other_day_heavy,0);
  v_allowed:=v_requested<=v_week_available and v_requested<=v_day_available
    and (v_physical_load<>'heavy' or (v_requested<=v_week_heavy_available and v_requested<=v_day_heavy_available));
  v_reason:=case
    when v_requested>v_week_available then 'Optional work would consume weekly capacity already claimed by required/protected work.'
    when v_requested>v_day_available then 'Optional work does not fit inside the requested day after human-time and existing placement claims.'
    when v_physical_load='heavy' and v_requested>v_week_heavy_available then 'Optional heavy work would consume weekly heavy-load capacity already claimed by required/protected work.'
    when v_physical_load='heavy' and v_requested>v_day_heavy_available then 'Optional heavy work exceeds the requested day heavy-load capacity after existing claims.'
    else 'Optional work fits inside capacity remaining after required/protected weekly claims.'
  end;

  return jsonb_build_object(
    'contractVersion','worker_optional_placement_warrant_v1','taskId',p_task_id,'serviceDate',p_service_date,
    'workClass','optional','physicalLoad',v_physical_load,'requestedMinutes',v_requested,'allowed',v_allowed,'reason',v_reason,
    'weeklyOptionalAvailableMinutes',v_week_available,'dayOptionalAvailableMinutes',v_day_available,
    'weeklyOptionalHeavyAvailableMinutes',v_week_heavy_available,'dayOptionalHeavyAvailableMinutes',v_day_heavy_available,
    'existingPlacementMinutesAddedBack',v_existing_minutes,'principalEscalationWarrant',false,
    'truthBoundary',jsonb_build_object(
      'optionalCandidateIsNotClaimUntilPlaced',true,
      'recoveryCapacityDoesNotAuthorizeNormalOptionalPlacement',true,
      'physicalLoadCapacityIsIndependentlyGuarded',true
    )
  );
end;
$$;

create or replace function atlas.worker_weekly_farm_contract_v6(
  p_farm_id uuid,
  p_membership_id uuid,
  p_anchor_day date default null
) returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_base jsonb;
  v_claims jsonb;
begin
  v_base:=atlas.worker_weekly_farm_contract_v5(p_farm_id,p_membership_id,p_anchor_day);
  v_claims:=atlas.worker_weekly_labor_claims_v2(p_farm_id,p_membership_id,p_anchor_day);
  return v_base
    || jsonb_build_object(
      'contractVersion','worker_weekly_farm_contract_v6',
      'laborClaims',v_claims,
      'laborClaimSummary',v_claims->'totals',
      'laborClaimPolicy',jsonb_build_object(
        'fixedCommitmentsAndHumanTimeReduceCapacityAtSource',true,
        'protectedMinimumsClaimBeforeOptionalWork',true,
        'requiredWorkClaimsBeforeOptionalWork',true,
        'optionalWorkClaimsOnlyWhenPlaced',true,
        'estimatesAreCapacityClaimsNotLaborActuals',true,
        'overCapacityBelongsToFarmOperationsBeforePrincipal',true
      )
    );
end;
$$;
revoke all on function atlas.worker_weekly_farm_contract_v6(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_farm_contract_v6(uuid,uuid,date) to service_role;

create or replace function atlas.worker_weekly_capacity_conflict_v2(
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
  v_claims jsonb;
  v_capacity jsonb;
  v_week_start date;
  v_week_end date;
  v_required integer:=0;
  v_protected integer:=0;
  v_required_heavy integer:=0;
  v_planned integer;
  v_recovery integer;
  v_planned_heavy integer;
  v_total_heavy integer;
  v_missing_planned integer;
  v_missing_total integer;
  v_heavy_missing_planned integer;
  v_heavy_missing_total integer;
  v_ready integer:=0;
  v_blocked integer:=0;
  v_state text;
  v_class text;
  v_downstream jsonb:='[]'::jsonb;
  v_item jsonb;
begin
  v_week:=atlas.worker_weekly_farm_contract_v6(p_farm_id,p_membership_id,p_anchor_day);
  v_claims:=v_week->'laborClaims';
  v_week_start:=(v_week->>'weekStart')::date;
  v_week_end:=(v_week->>'weekEnd')::date;
  v_capacity:=atlas.worker_capacity_window_v1(p_farm_id,p_membership_id,v_week_start,v_week_end);

  v_required:=coalesce((v_claims#>>'{totals,requiredClaimMinutes}')::integer,0);
  v_protected:=coalesce((v_claims#>>'{totals,protectedRequiredClaimMinutes}')::integer,0);
  v_required_heavy:=coalesce((v_claims#>>'{totals,requiredHeavyClaimMinutes}')::integer,0);
  if coalesce((v_capacity->>'capacityKnown')::boolean,false) then
    v_planned:=coalesce((v_claims#>>'{capacity,plannedCapacityMinutes}')::integer,0);
    v_recovery:=coalesce((v_claims#>>'{capacity,recoveryCapacityMinutes}')::integer,0);
    v_planned_heavy:=coalesce((v_claims#>>'{capacity,plannedHeavyMinutesSoftCap}')::integer,0);
    v_total_heavy:=coalesce((v_claims#>>'{capacity,totalHeavyMinutesSoftCapIncludingRecovery}')::integer,0);
    v_missing_planned:=greatest(v_required-v_planned,0);
    v_missing_total:=greatest(v_required-v_planned-v_recovery,0);
    v_heavy_missing_planned:=greatest(v_required_heavy-v_planned_heavy,0);
    v_heavy_missing_total:=greatest(v_required_heavy-v_total_heavy,0);
    v_class:=case
      when v_missing_total>0 and v_heavy_missing_total>0 then 'labor_and_physical_load'
      when v_missing_total>0 then 'labor_capacity'
      when v_heavy_missing_total>0 then 'physical_load_capacity'
      when v_missing_planned>0 and v_heavy_missing_planned>0 then 'recovery_required_labor_and_physical_load'
      when v_missing_planned>0 then 'recovery_required_labor'
      when v_heavy_missing_planned>0 then 'recovery_required_physical_load'
      else null end;
    v_state:=case
      when v_missing_total>0 or v_heavy_missing_total>0 then 'management_conflict'
      when v_missing_planned>0 or v_heavy_missing_planned>0 then 'recovery_required'
      else 'feasible' end;
  else
    v_state:=case when v_capacity->>'state'='capacity_policy_conflict' then 'capacity_policy_conflict' else 'capacity_truth_required' end;
  end if;

  for v_item in select value from jsonb_array_elements(coalesce(v_week->'work','[]'::jsonb)) loop
    if coalesce((v_item->>'requiredThisWeek')::boolean,false) then
      if coalesce((v_item->>'executionReady')::boolean,false) then
        v_ready:=v_ready+coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer,0);
      else
        v_blocked:=v_blocked+coalesce(nullif(v_item->>'expectedActiveMinutes','')::integer,0);
      end if;
      v_downstream:=v_downstream||jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'taskId',v_item->>'taskId','title',v_item->>'title','protectedFarmMinimum',v_item->'protectedFarmMinimum',
        'consequenceTier',v_item->'effectiveConsequenceTier','consequenceClass',v_item->>'effectiveConsequenceClass',
        'dueDate',v_item->>'dueDate','latestLawfulDate',v_item->>'latestLawfulDate','hardFinishDate',v_item->>'hardFinishDate'
      )));
    end if;
  end loop;

  return jsonb_build_object(
    'contractVersion','worker_weekly_capacity_conflict_v2',
    'farmId',p_farm_id,'membershipId',p_membership_id,'weekStart',v_week_start,'weekEnd',v_week_end,
    'state',v_state,'conflictClass',v_class,
    'hasCapacityConflict',case when coalesce((v_capacity->>'capacityKnown')::boolean,false) then v_state='management_conflict' else null end,
    'managementResolutionRequired',v_state='management_conflict',
    'principalEscalationWarrant',false,
    'laborClaims',v_claims,
    'capacityTruth',v_capacity,
    'laborRequiredMinutes',v_required,'protectedFarmMinimumMinutes',v_protected,
    'heavyLaborRequiredMinutes',v_required_heavy,
    'laborAvailablePlannedMinutes',v_planned,'laborAvailableRecoveryMinutes',v_recovery,
    'laborAvailableIncludingRecoveryMinutes',case when v_planned is null then null else v_planned+v_recovery end,
    'missingPlannedCapacityMinutes',v_missing_planned,'missingCapacityIncludingRecoveryMinutes',v_missing_total,
    'heavyLaborPlannedSoftCapMinutes',v_planned_heavy,'heavyLaborIncludingRecoverySoftCapMinutes',v_total_heavy,
    'heavyLoadMissingPlannedMinutes',v_heavy_missing_planned,'heavyLoadMissingIncludingRecoveryMinutes',v_heavy_missing_total,
    'readyRequiredMinutes',v_ready,'blockedRequiredMinutes',v_blocked,
    'remainingOptionalPlannedAvailabilityMinutes',v_claims#>'{totals,remainingOptionalPlannedAvailabilityMinutes}',
    'remainingOptionalHeavyAvailabilityMinutes',v_claims#>'{totals,remainingOptionalHeavyAvailabilityMinutes}',
    'downstreamConsequence',v_downstream,
    'weatherCompression',jsonb_build_object('state','unmodeled','known',false,'reason','No canonical Atlas weather-capacity service exists yet; Sky timing is not substituted for weather.'),
    'farmTruthMutated',false,'conflictIsDerivedEvidence',true,
    'truthBoundary',jsonb_build_object(
      'estimateIsCapacityClaimNotLaborActual',true,
      'placedRequiredWorkIsNotDoubleCountedAgainstRemainingCapacity',true,
      'optionalClaimsAreDisplaceableBeforeDeclaringRequiredWorkImpossible',true,
      'managementConflictDoesNotCreatePrincipalWorkByItself',true
    )
  );
end;
$$;
revoke all on function atlas.worker_weekly_capacity_conflict_v2(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.worker_weekly_capacity_conflict_v2(uuid,uuid,date) to service_role;

create or replace function atlas.owner_weekly_farm_contract_api_v1(p_farm_id uuid,p_membership_id uuid,p_anchor_day date default null)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not atlas.is_farm_owner(p_farm_id) then raise exception 'Owner farm membership required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand') then raise exception 'Active Farm Hand membership required.' using errcode='42501'; end if;
  return atlas.worker_weekly_farm_contract_v6(p_farm_id,p_membership_id,p_anchor_day);
end; $$;

create or replace function atlas.worker_self_weekly_farm_contract_api_v1(p_farm_id uuid,p_membership_id uuid,p_anchor_day date default null)
returns jsonb language plpgsql stable security definer set search_path to 'pg_catalog','atlas','auth' as $$
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if not exists(select 1 from atlas.farm_memberships fm where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.user_id=auth.uid() and fm.active=true and fm.role='farm_hand') then raise exception 'The Weekly Farm Contract may only be read by that active Farm Hand.' using errcode='42501'; end if;
  return atlas.worker_weekly_farm_contract_v6(p_farm_id,p_membership_id,p_anchor_day);
end; $$;
