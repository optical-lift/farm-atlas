create or replace function atlas.production_flow_buffer_claim_v1(p_production_lot_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_lot atlas.production_lots%rowtype;
  v_base jsonb;
  v_seed_claim_sets jsonb := '[]'::jsonb;
  v_seed_claim_set_count integer := 0;
  v_subject_seed_claim_quantity numeric := 0;
  v_total_seed_claim_quantity numeric := 0;
  v_seed_claim_count integer := 0;
  v_seed_allocation_ready boolean := false;
  v_capacity_state text := 'unresolved';
  v_destination_state text := 'unresolved';
  v_current_function text := 'inspect';
  v_current_operation_state text := 'unresolved';
  v_labor_claims jsonb := '[]'::jsonb;
  v_labor_claim_count integer := 0;
  v_labor_claim_minutes integer := null;
  v_sow_policy_estimate integer := null;
  v_sow_policy_candidates jsonb := '[]'::jsonb;
  v_sow_observed_evidence jsonb := null;
  v_current_labor_requirement_state text := 'unresolved';
  v_capacity_fit_state text := 'not_evaluable';
  v_availability_state text := 'not_available';
  v_availability_reasons jsonb := '[]'::jsonb;
begin
  if p_production_lot_id is null then
    raise exception 'A production lot is required.' using errcode = '22023';
  end if;

  select * into v_lot
  from atlas.production_lots
  where id = p_production_lot_id;

  if v_lot.id is null then
    raise exception 'Production lot not found.' using errcode = 'P0002';
  end if;

  v_base := atlas.reality_expression_packet_v1(v_lot.id);
  v_seed_allocation_ready := coalesce((v_base #>> '{inputs,seedReadiness,all_seed_allocations_ready}')::boolean,false);
  v_capacity_state := coalesce(v_base #>> '{spatialReadiness,state}','unresolved');
  v_destination_state := coalesce(v_base #>> '{claims,destinationClaim,state}','unresolved');
  v_current_function := coalesce(v_base #>> '{fittingOperation,function}','inspect');
  v_current_operation_state := coalesce(v_base #>> '{fittingOperation,state}','unresolved');

  with subject_seed_lots as (
    select distinct c.seed_lot_id
    from atlas.seed_allocation_coverage_v1 c
    where c.production_lot_id = v_lot.id
      and coalesce(c.outstanding_quantity,0) > 0
  ),
  claim_sets as (
    select
      s.seed_lot_id,
      coalesce(sum(c.outstanding_quantity) filter (where c.production_lot_id=v_lot.id),0) as subject_claim_quantity,
      coalesce(sum(c.outstanding_quantity),0) as total_claim_quantity,
      count(*)::integer as claim_count,
      bool_and(coalesce(c.count_trusted,false)) as count_trusted,
      max(c.projected_on_hand_quantity) as projected_on_hand_quantity,
      max(c.last_verified_at) as last_verified_at,
      coalesce(jsonb_agg(jsonb_build_object(
        'allocationId',c.allocation_id,
        'productionLotId',c.production_lot_id,
        'productionLotLabel',c.production_lot_label,
        'plannedSowDate',c.planned_sow_date,
        'allocationStatus',c.allocation_status,
        'outstandingQuantity',c.outstanding_quantity,
        'unit',c.unit,
        'coveredByTrustedInventory',c.covered_by_trusted_inventory,
        'blockingReason',c.blocking_reason
      ) order by c.planned_sow_date,c.allocation_id),'[]'::jsonb) as claim_rows
    from subject_seed_lots s
    join atlas.seed_allocation_coverage_v1 c on c.seed_lot_id=s.seed_lot_id
    where coalesce(c.outstanding_quantity,0)>0
    group by s.seed_lot_id
  ),
  rendered as (
    select
      cs.*,
      inv.received_quantity,
      inv.reserved_quantity,
      inv.available_quantity as nominal_unreserved_quantity,
      inv.consumed_quantity,
      case when cs.count_trusted then cs.projected_on_hand_quantity else null end as trusted_physical_on_hand_quantity,
      case when cs.count_trusted and cs.projected_on_hand_quantity is not null
           then greatest(cs.projected_on_hand_quantity-cs.total_claim_quantity,0)
           else null end as trusted_unclaimed_available_quantity,
      case
        when cs.count_trusted and cs.projected_on_hand_quantity is not null and cs.total_claim_quantity>cs.projected_on_hand_quantity then 'established_overallocation'
        when cs.count_trusted and cs.projected_on_hand_quantity is not null then 'not_established'
        else 'insufficient_physical_warrant'
      end as collision_state,
      case
        when cs.claim_count>1 and (not cs.count_trusted or cs.projected_on_hand_quantity is null) then 'shared_claims_unresolved_physical_warrant'
        when cs.claim_count>1 and cs.total_claim_quantity>cs.projected_on_hand_quantity then 'shared_claims_overallocated'
        when cs.claim_count>1 then 'shared_claims_covered'
        when cs.claim_count=1 and (not cs.count_trusted or cs.projected_on_hand_quantity is null) then 'single_claim_unresolved_physical_warrant'
        when cs.claim_count=1 and cs.total_claim_quantity>cs.projected_on_hand_quantity then 'single_claim_exceeds_trusted_physical_quantity'
        else 'single_claim_covered'
      end as relation_state
    from claim_sets cs
    left join atlas.seed_lot_inventory_v1 inv on inv.seed_lot_id=cs.seed_lot_id
  )
  select
    count(*)::integer,
    coalesce(sum(subject_claim_quantity),0),
    coalesce(sum(total_claim_quantity),0),
    coalesce(sum(claim_count),0)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'seedLotId',seed_lot_id,
      'subjectClaimQuantity',subject_claim_quantity,
      'totalClaimQuantity',total_claim_quantity,
      'claimCount',claim_count,
      'countTrusted',count_trusted,
      'lastVerifiedAt',last_verified_at,
      'ledger',jsonb_build_object(
        'receivedQuantity',received_quantity,
        'reservedQuantity',reserved_quantity,
        'nominalUnreservedQuantity',nominal_unreserved_quantity,
        'consumedQuantity',consumed_quantity
      ),
      'physicalWarrant',jsonb_build_object(
        'state',case when count_trusted and projected_on_hand_quantity is not null then 'trusted_current_count' else 'not_currently_established' end,
        'trustedPhysicalOnHandQuantity',trusted_physical_on_hand_quantity,
        'trustedUnclaimedAvailableQuantity',trusted_unclaimed_available_quantity,
        'projectedOnHandQuantity',projected_on_hand_quantity
      ),
      'relationState',relation_state,
      'collision',jsonb_build_object(
        'state',collision_state,
        'conflictEstablished',collision_state='established_overallocation'
      ),
      'claims',claim_rows
    ) order by seed_lot_id),'[]'::jsonb)
  into v_seed_claim_set_count,v_subject_seed_claim_quantity,v_total_seed_claim_quantity,v_seed_claim_count,v_seed_claim_sets
  from rendered;

  select
    count(*)::integer,
    sum(w.planned_duration_minutes)::integer,
    coalesce(jsonb_agg(jsonb_build_object(
      'placementId',w.id,
      'taskId',t.id,
      'taskTitle',t.title,
      'taskStatus',t.status,
      'taskOperationClass',t.operation_class,
      'membershipId',w.membership_id,
      'serviceDate',w.service_date,
      'plannedDurationMinutes',w.planned_duration_minutes,
      'placementState',w.state
    ) order by w.service_date,w.id),'[]'::jsonb)
  into v_labor_claim_count,v_labor_claim_minutes,v_labor_claims
  from atlas.production_lot_tasks plt
  join atlas.tasks t on t.id=plt.task_id
  join atlas.worker_day_task_placements w on w.task_id=t.id and w.state='placed'
  where plt.production_lot_id=v_lot.id
    and t.status not in ('done','archived','skipped');

  select r.expected_active_minutes
  into v_sow_policy_estimate
  from atlas.task_capacity_rules r
  where r.farm_id=v_lot.farm_id
    and r.active=true
    and (upper(coalesce(r.match_action_key,''))='SOW' or upper(coalesce(r.match_task_type,''))='SOW_SEEDS')
    and r.expected_active_minutes is not null
  order by r.priority desc,r.rule_key
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
      'ruleKey',r.rule_key,
      'matchActionKey',r.match_action_key,
      'matchTaskType',r.match_task_type,
      'expectedActiveMinutes',r.expected_active_minutes,
      'physicalLoad',r.physical_load,
      'priority',r.priority
    ) order by r.priority desc,r.rule_key),'[]'::jsonb)
  into v_sow_policy_candidates
  from atlas.task_capacity_rules r
  where r.farm_id=v_lot.farm_id
    and r.active=true
    and (upper(coalesce(r.match_action_key,''))='SOW' or upper(coalesce(r.match_task_type,''))='SOW_SEEDS')
    and r.expected_active_minutes is not null;

  select to_jsonb(e)
  into v_sow_observed_evidence
  from atlas.production_operation_labor_evidence_v1 e
  where e.farm_id=v_lot.farm_id
    and lower(e.operation_class) in ('sow','sowing','sow_seed','sow_seeds')
  order by e.sample_count desc,e.last_observed_date desc nulls last
  limit 1;

  v_current_labor_requirement_state := case
    when v_current_function='sow' and v_sow_observed_evidence is not null then 'current_operation_estimate_supported_by_observed_evidence'
    when v_current_function='sow' and v_sow_policy_estimate is not null then 'current_operation_policy_estimate_available'
    when v_current_function='sow' then 'current_operation_duration_unresolved'
    else 'not_established_for_current_operation'
  end;

  v_capacity_fit_state := case
    when v_labor_claim_count=0 then 'not_evaluable_no_human_time_claim'
    else 'not_evaluated_by_phase4_projection'
  end;

  if not v_seed_allocation_ready then
    v_availability_reasons := v_availability_reasons || jsonb_build_array(jsonb_build_object(
      'key','input_physical_warrant_unresolved',
      'detail',coalesce(v_base #>> '{inputs,seedReadiness,blocking_reason}','Seed allocation readiness is not established.')
    ));
  end if;

  if v_capacity_state <> 'ready' then
    v_availability_reasons := v_availability_reasons || jsonb_build_array(jsonb_build_object(
      'key','destination_or_capacity_not_ready',
      'detail','Canonical production capacity/readiness is not ready.'
    ));
  end if;

  if v_destination_state='unresolved' then
    v_availability_reasons := v_availability_reasons || jsonb_build_array(jsonb_build_object(
      'key','destination_claim_unresolved',
      'detail','No canonical destination claim is established for this production lot.'
    ));
  end if;

  if v_labor_claim_count=0 then
    v_availability_reasons := v_availability_reasons || jsonb_build_array(jsonb_build_object(
      'key','human_time_unclaimed',
      'detail','No active Worker Day placement claims human time for a linked production task.'
    ));
  end if;

  if v_current_function in ('resolve_readiness','wait','inspect_continuity','inspect') then
    v_availability_state := 'not_available';
  elsif v_current_function='no_further_operation' then
    v_availability_state := 'terminal';
  elsif v_current_function='continue_linked_crop_body' then
    v_availability_state := 'delegated_to_linked_crop_reality';
  elsif v_current_function='sow' and v_seed_allocation_ready and v_capacity_state='ready' then
    v_availability_state := case when v_labor_claim_count>0 then 'claimed_for_execution_capacity_fit_unverified' else 'available_for_routing_unclaimed' end;
  else
    v_availability_state := 'not_available';
  end if;

  return jsonb_build_object(
    'contractVersion','production_flow_buffer_claim_v1',
    'subject',jsonb_build_object(
      'type','production_lot',
      'id',v_lot.id,
      'stableKey',v_lot.stable_key,
      'label',v_lot.lot_label,
      'farmId',v_lot.farm_id
    ),
    'physical',jsonb_build_object(
      'cropBodyQuantity',v_base #> '{currentState,currentQuantity}',
      'inputSeedClaimSets',v_seed_claim_sets,
      'principle','Recorded inventory position is not promoted to trusted current physical availability when its verification warrant is stale or absent.'
    ),
    'flowBuffer',jsonb_build_object(
      'possessionState',case when v_seed_claim_set_count>0 then 'recorded_inventory_and_claims_present' else 'no_seed_claim_position' end,
      'subjectInputAvailabilityState',case when v_seed_claim_set_count=0 then 'not_applicable_or_unrepresented' when v_seed_allocation_ready then 'claimed_input_available_to_subject' else 'not_established' end,
      'destinationReadinessState',v_capacity_state,
      'destinationClaimState',v_destination_state,
      'principle','Possession, physical warrant, unclaimed availability, a subject claim, and destination readiness are separate facts.'
    ),
    'claims',jsonb_build_object(
      'seed',jsonb_build_object(
        'subjectClaimQuantity',v_subject_seed_claim_quantity,
        'totalClaimQuantityAcrossSharedSeedLots',v_total_seed_claim_quantity,
        'claimCountAcrossSharedSeedLots',v_seed_claim_count,
        'claimSets',v_seed_claim_sets
      ),
      'destination',v_base #> '{claims,destinationClaim}',
      'labor',jsonb_build_object(
        'state',case when v_labor_claim_count>0 then 'human_time_claim_present' else 'none' end,
        'claimCount',v_labor_claim_count,
        'claimedMinutes',v_labor_claim_minutes,
        'placements',v_labor_claims,
        'principle','A task estimate or production requirement does not become a human-time claim until a canonical worker placement claims that time.'
      )
    ),
    'laborDemand',jsonb_build_object(
      'currentOperationFunction',v_current_function,
      'currentOperationState',v_current_operation_state,
      'currentRequirementState',v_current_labor_requirement_state,
      'futureKnownSowEstimate',jsonb_build_object(
        'minutes',v_sow_policy_estimate,
        'sourceClass',case when v_sow_policy_estimate is null then 'unresolved' else 'task_capacity_rule_policy' end,
        'policyCandidates',v_sow_policy_candidates,
        'observedEvidence',v_sow_observed_evidence,
        'isHumanTimeClaim',false
      )
    ),
    'capacityFit',jsonb_build_object(
      'state',v_capacity_fit_state,
      'principle','Worker placement can establish a time claim; Phase 4 does not infer whole-day capacity fit from the placement alone.'
    ),
    'nextTransitionAvailability',jsonb_build_object(
      'state',v_availability_state,
      'operationFunction',v_current_function,
      'reasons',v_availability_reasons,
      'principle','Existence or reservation alone does not make an operation available. Current physical warrant, destination/readiness, fitting function, jurisdiction, and human claim remain distinct.'
    ),
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'duplicatesCanonicalState',false,
      'possessionIsNotAvailability',true,
      'reservationIsNotPhysicalProof',true,
      'multipleClaimsAreNotConflictWithoutCapacityEvidence',true,
      'laborEstimateIsNotLaborClaim',true,
      'unresolvedDestinationIsNotExecutableOperation',true
    )
  );
end;
$function$;

revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from public;
revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from anon;
revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from authenticated;
grant execute on function atlas.production_flow_buffer_claim_v1(uuid) to service_role;

create or replace function atlas.reality_expression_packet_v2(p_production_lot_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_base jsonb;
  v_phase4 jsonb;
begin
  v_base := atlas.reality_expression_packet_v1(p_production_lot_id);
  v_phase4 := atlas.production_flow_buffer_claim_v1(p_production_lot_id);

  return jsonb_set(v_base,'{contractVersion}','"reality_expression_packet_v2"'::jsonb,true)
    || jsonb_build_object(
      'contractLineage',jsonb_build_array('reality_expression_packet_v1','production_flow_buffer_claim_v1'),
      'flowBufferClaim',v_phase4
    );
end;
$function$;

revoke all on function atlas.reality_expression_packet_v2(uuid) from public;
revoke all on function atlas.reality_expression_packet_v2(uuid) from anon;
revoke all on function atlas.reality_expression_packet_v2(uuid) from authenticated;
grant execute on function atlas.reality_expression_packet_v2(uuid) to service_role;
