begin;

create or replace function atlas.reality_expression_packet_v1(p_production_lot_id uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_lot atlas.production_lots%rowtype;
  v_program atlas.production_programs%rowtype;
  v_events jsonb := '[]'::jsonb;
  v_crop_cycles jsonb := '[]'::jsonb;
  v_tasks jsonb := '[]'::jsonb;
  v_seed_allocations jsonb := '[]'::jsonb;
  v_bed_assignments jsonb := '[]'::jsonb;
  v_capacity_reservations jsonb := '[]'::jsonb;
  v_seed_readiness jsonb := null;
  v_capacity_readiness jsonb := null;
  v_latest_event jsonb := null;
  v_gaps jsonb := '[]'::jsonb;
  v_seed_allocation_count integer := 0;
  v_crop_cycle_count integer := 0;
  v_task_count integer := 0;
  v_bed_assignment_count integer := 0;
  v_capacity_reservation_count integer := 0;
  v_unknown_seed_locations integer := 0;
  v_fitting_function text := 'inspect';
  v_operation_state text := 'unresolved';
  v_operation_reason text := 'Atlas does not yet have enough canonical state to name a more specific fitting operation.';
  v_expected_transition text := null;
  v_next_lifecycle_state text := null;
  v_materialization_state text;
  v_destination_state text;
  v_location_state text;
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

  select * into v_program
  from atlas.production_programs
  where id = v_lot.program_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'eventId',e.id,
    'eventType',e.event_type,
    'eventDate',e.event_date,
    'quantity',e.quantity,
    'unit',e.unit,
    'taskId',e.task_id,
    'cropCycleId',e.crop_cycle_id,
    'objectId',e.object_id,
    'trayBatchId',e.tray_batch_id,
    'source',e.source,
    'note',e.note,
    'metadata',e.metadata,
    'createdAt',e.created_at
  ) order by e.event_date,e.created_at,e.id),'[]'::jsonb)
  into v_events
  from atlas.production_lot_events e
  where e.production_lot_id=v_lot.id;

  select jsonb_build_object(
    'eventId',e.id,
    'eventType',e.event_type,
    'eventDate',e.event_date,
    'quantity',e.quantity,
    'unit',e.unit,
    'source',e.source,
    'createdAt',e.created_at
  )
  into v_latest_event
  from atlas.production_lot_events e
  where e.production_lot_id=v_lot.id
  order by e.event_date desc,e.created_at desc,e.id desc
  limit 1;

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'linkId',link.id,
           'cropCycleId',cycle.id,
           'relationRole',link.relation_role,
           'confidence',link.confidence,
           'source',link.source,
           'cropLabel',cycle.crop_label,
           'variety',cycle.variety,
           'lifecycleStatus',cycle.lifecycle_status,
           'objectId',obj.id,
           'objectKey',obj.stable_key,
           'objectLabel',obj.label,
           'reality',atlas.crop_cycle_reality_expression_v4(cycle.id)
         ) order by link.created_at,link.id),'[]'::jsonb)
  into v_crop_cycle_count,v_crop_cycles
  from atlas.production_lot_crop_cycles link
  join atlas.crop_cycles cycle on cycle.id=link.crop_cycle_id
  left join atlas.growing_objects obj on obj.id=cycle.object_id
  where link.production_lot_id=v_lot.id;

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'linkId',link.id,
           'taskId',link.task_id,
           'relationRole',link.relation_role,
           'confidence',link.confidence,
           'source',link.source,
           'metadata',link.metadata
         ) order by link.created_at,link.id),'[]'::jsonb)
  into v_task_count,v_tasks
  from atlas.production_lot_tasks link
  where link.production_lot_id=v_lot.id;

  select count(*)::integer,
         count(*) filter (where seed.storage_location is null)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'allocationId',a.id,
           'allocationStatus',a.allocation_status,
           'allocatedQuantity',a.allocated_quantity,
           'unit',a.unit,
           'allocatedAt',a.allocated_at,
           'seedLotId',seed.id,
           'seedLotKey',seed.stable_key,
           'seedLotLabel',seed.lot_label,
           'seedLotStatus',seed.status,
           'storageLocation',seed.storage_location,
           'receivedQuantity',inv.received_quantity,
           'reservedQuantity',inv.reserved_quantity,
           'availableQuantity',inv.available_quantity,
           'consumedQuantity',inv.consumed_quantity,
           'inventoryStatus',inv.status,
           'inventoryMetadata',inv.metadata,
           'allocationMetadata',a.metadata
         ) order by a.allocated_at,a.id),'[]'::jsonb)
  into v_seed_allocation_count,v_unknown_seed_locations,v_seed_allocations
  from atlas.seed_lot_allocations a
  join atlas.seed_lots seed on seed.id=a.seed_lot_id
  left join atlas.seed_lot_inventory_v1 inv on inv.seed_lot_id=seed.id
  where a.production_lot_id=v_lot.id;

  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_build_object(
           'assignmentId',a.id,
           'requirementId',a.requirement_id,
           'objectId',obj.id,
           'objectKey',obj.stable_key,
           'objectLabel',obj.label,
           'quantityAssigned',a.quantity_assigned,
           'unit',a.unit,
           'plannedTransplantDate',a.planned_transplant_date,
           'expectedReleaseDate',a.expected_release_date,
           'assignmentStatus',a.assignment_status,
           'source',a.source,
           'metadata',a.metadata
         ) order by a.created_at,a.id),'[]'::jsonb)
  into v_bed_assignment_count,v_bed_assignments
  from atlas.production_bed_assignments a
  left join atlas.growing_objects obj on obj.id=a.object_id
  where a.production_lot_id=v_lot.id;

  select count(*)::integer,
         coalesce(jsonb_agg(to_jsonb(r) order by r.created_at,r.id),'[]'::jsonb)
  into v_capacity_reservation_count,v_capacity_reservations
  from atlas.production_capacity_reservations r
  where r.production_lot_id=v_lot.id;

  select to_jsonb(r) into v_seed_readiness
  from atlas.production_seed_readiness_v1 r
  where r.production_lot_id=v_lot.id;

  select to_jsonb(r) into v_capacity_readiness
  from atlas.production_capacity_readiness_v1 r
  where r.production_lot_id=v_lot.id;

  v_materialization_state := case
    when v_crop_cycle_count > 0 then 'materialized_crop_body_linked'
    when v_lot.actual_sow_date is not null then 'sown_without_linked_crop_body'
    else 'planned_not_yet_materialized'
  end;

  v_location_state := case
    when v_crop_cycle_count > 0 then 'represented_by_linked_crop_body'
    when v_seed_allocation_count > 0 and v_unknown_seed_locations=0 then 'input_custody_represented'
    when v_seed_allocation_count > 0 then 'input_custody_partially_unresolved'
    else 'unresolved'
  end;

  v_destination_state := case
    when v_bed_assignment_count > 0 then 'bed_assignment_present'
    when v_capacity_reservation_count > 0 then 'capacity_reserved_without_bed_assignment'
    else 'unresolved'
  end;

  if v_lot.current_quantity is null then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','current_quantity_unknown','class','state_gap','detail','Production lot current quantity is not recorded. Planned input quantity is preserved separately and is not substituted as current quantity.'
    ));
  end if;

  if v_seed_readiness is null then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','seed_readiness_unrepresented','class','input_gap','detail','No canonical seed-readiness projection is available for this production lot.'
    ));
  elsif coalesce((v_seed_readiness->>'all_seed_allocations_ready')::boolean,false)=false then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','seed_readiness_blocked','class','input_gap','detail',coalesce(v_seed_readiness->>'blocking_reason','Seed readiness is not established.'),'evidence',v_seed_readiness
    ));
  end if;

  if v_capacity_readiness is null then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','capacity_readiness_unrepresented','class','destination_gap','detail','No canonical capacity-readiness projection is available for this production lot.'
    ));
  elsif coalesce(v_capacity_readiness->>'readiness_status','') <> 'ready' then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','capacity_readiness_not_ready','class','destination_gap','detail','Canonical production capacity/readiness is not ready.','evidence',v_capacity_readiness
    ));
  end if;

  if v_bed_assignment_count=0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','destination_bed_unresolved','class','destination_gap','detail','No canonical production bed assignment currently claims a growing object for this lot.'
    ));
  end if;

  if v_seed_allocation_count>0 and v_unknown_seed_locations>0 then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','input_storage_location_unknown','class','custody_gap','detail','At least one allocated seed lot has no recorded storage location.'
    ));
  end if;

  if v_crop_cycle_count=0 and v_lot.actual_sow_date is not null then
    v_gaps := v_gaps || jsonb_build_array(jsonb_build_object(
      'key','sown_lot_missing_crop_body_link','class','continuity_gap','detail','The lot records an actual sow date but no canonical crop-cycle body is linked.'
    ));
  end if;

  if v_lot.lifecycle_status in ('cancelled','terminated','completed') then
    v_fitting_function := 'no_further_operation';
    v_operation_state := 'terminal_or_complete';
    v_operation_reason := 'The production lot lifecycle status is terminal or complete.';
  elsif v_lot.actual_sow_date is null then
    if (v_seed_readiness is not null and coalesce((v_seed_readiness->>'all_seed_allocations_ready')::boolean,false)=false)
       or (v_capacity_readiness is not null and coalesce(v_capacity_readiness->>'readiness_status','') <> 'ready') then
      v_fitting_function := 'resolve_readiness';
      v_operation_state := case when v_lot.planned_sow_date is not null and current_date < v_lot.planned_sow_date then 'prepare_before_window' else 'blocking_next_operation' end;
      v_operation_reason := 'Canonical input and/or capacity readiness is unresolved, so Atlas cannot lawfully express a confident sow operation yet.';
      v_expected_transition := 'readiness unresolved -> readiness established or explicitly reclassified';
      v_next_lifecycle_state := v_lot.lifecycle_status;
    elsif v_lot.planned_sow_date is not null and current_date < v_lot.planned_sow_date then
      v_fitting_function := 'wait';
      v_operation_state := 'pre_window';
      v_operation_reason := 'The planned sow date has not arrived and no earlier blocking condition currently requires a different operation.';
      v_expected_transition := 'pre-window -> sow window reached';
      v_next_lifecycle_state := v_lot.lifecycle_status;
    else
      v_fitting_function := 'sow';
      v_operation_state := 'candidate_operation';
      v_operation_reason := 'The lot is unsown and no canonical readiness blocker was found by this adapter.';
      v_expected_transition := 'planned/unsown -> sow evidence recorded';
      v_next_lifecycle_state := 'unresolved_until_canonical_sow_transition';
    end if;
  elsif v_crop_cycle_count>0 then
    v_fitting_function := 'continue_linked_crop_body';
    v_operation_state := 'delegate_to_linked_crop_reality';
    v_operation_reason := 'A materialized crop body exists; the fitting operation must come from the linked crop-cycle reality packet rather than from production-lot planning fields.';
    v_expected_transition := 'determined by linked crop-cycle state and evidence';
    v_next_lifecycle_state := 'determined_by_canonical_crop_transition';
  else
    v_fitting_function := 'inspect_continuity';
    v_operation_state := 'continuity_gap';
    v_operation_reason := 'The lot records sow evidence but has no linked crop body from which Atlas can reconstruct the next living-state operation.';
    v_expected_transition := 'establish lawful crop-body lineage or reclassify the lot';
    v_next_lifecycle_state := 'unresolved';
  end if;

  return jsonb_build_object(
    'contractVersion','reality_expression_packet_v1',
    'adapter','production_lot',
    'asOf',now(),
    'subject',jsonb_build_object(
      'type','production_lot','id',v_lot.id,'stableKey',v_lot.stable_key,'label',v_lot.lot_label,'farmId',v_lot.farm_id,'materializationState',v_materialization_state
    ),
    'source',jsonb_build_object(
      'state',case when v_program.id is not null then 'established' else 'partially_unresolved' end,
      'program',case when v_program.id is null then null else jsonb_build_object('id',v_program.id,'stableKey',v_program.stable_key,'label',v_program.program_label,'kind',v_program.program_kind,'promise',v_program.promise_text,'status',v_program.status) end,
      'productionPlanId',v_lot.production_plan_id,
      'productionSuccessionId',v_lot.production_succession_id,
      'sourceTaskKey',v_lot.metadata->>'source_task_key'
    ),
    'witness',jsonb_build_object(
      'state',case when jsonb_array_length(v_events)>0 then 'event_evidence_present' else 'no_lot_event_evidence' end,
      'latest',v_latest_event,
      'events',v_events,
      'principle','Events are evidence of what was recorded; planned quantities and dates are not silently promoted to observed current state.'
    ),
    'currentState',jsonb_build_object(
      'stage',v_lot.current_stage,
      'lifecycleStatus',v_lot.lifecycle_status,
      'currentQuantity',jsonb_build_object('value',v_lot.current_quantity,'unit',v_lot.current_unit,'certainty',case when v_lot.current_quantity is null then 'unresolved' else 'recorded' end),
      'plannedInput',jsonb_build_object('value',v_lot.planned_input_quantity,'unit',v_lot.planned_input_unit,'certainty',case when v_lot.planned_input_quantity is null then 'unresolved' else coalesce(v_lot.metadata->>'quantity_confidence','recorded_plan') end),
      'actualSowDate',v_lot.actual_sow_date
    ),
    'flowBuffer',jsonb_build_object(
      'materializationState',v_materialization_state,
      'seedAllocations',v_seed_allocations,
      'linkedCropBodies',v_crop_cycles
    ),
    'locationCustody',jsonb_build_object(
      'state',v_location_state,
      'linkedCropBodies',v_crop_cycles,
      'inputSeedAllocations',v_seed_allocations,
      'principle','Input custody is not the same thing as a materialized crop body location.'
    ),
    'inputs',jsonb_build_object(
      'seedReadiness',v_seed_readiness,
      'seedAllocations',v_seed_allocations
    ),
    'claims',jsonb_build_object(
      'inputClaims',v_seed_allocations,
      'destinationClaim',jsonb_build_object('state',v_destination_state,'bedAssignments',v_bed_assignments,'capacityReservations',v_capacity_reservations),
      'intendedUses',to_jsonb(v_lot.intended_uses)
    ),
    'spatialReadiness',jsonb_build_object(
      'state',case when v_capacity_readiness is null then 'unresolved' else coalesce(v_capacity_readiness->>'readiness_status','unresolved') end,
      'capacity',v_capacity_readiness,
      'bedAssignments',v_bed_assignments
    ),
    'fittingOperation',jsonb_build_object(
      'function',v_fitting_function,
      'state',v_operation_state,
      'reason',v_operation_reason,
      'linkedTasks',v_tasks
    ),
    'jurisdiction',jsonb_build_object(
      'system','farm_operations',
      'state','system_jurisdiction_established_human_carrier_not_inferred',
      'humanCarrier',case when v_task_count>0 then jsonb_build_object('state','represented_by_linked_task','taskLinks',v_tasks) else jsonb_build_object('state','unresolved','taskLinks','[]'::jsonb) end,
      'principle','This adapter does not convert a production requirement into a human assignment. Worker execution must still enter through the canonical obligation/release/Clock path.'
    ),
    'timing',jsonb_build_object(
      'plannedSowDate',v_lot.planned_sow_date,
      'actualSowDate',v_lot.actual_sow_date,
      'expectedTransplantStart',v_lot.expected_transplant_start,
      'expectedTransplantEnd',v_lot.expected_transplant_end,
      'expectedHarvestStart',v_lot.expected_harvest_start,
      'expectedHarvestEnd',v_lot.expected_harvest_end,
      'relationToPlannedSow',case when v_lot.planned_sow_date is null then 'unresolved' when current_date < v_lot.planned_sow_date then 'before_planned_sow' when current_date=v_lot.planned_sow_date then 'planned_sow_date' else 'after_planned_sow' end
    ),
    'expectedTransition',jsonb_build_object('description',v_expected_transition,'nextLifecycleState',v_next_lifecycle_state,'certainty','derived_or_unresolved_not_observed'),
    'continuity',jsonb_build_object(
      'state',case when jsonb_array_length(v_gaps)=0 then 'continuous_from_current_evidence' else 'gaps_present' end,
      'gapCount',jsonb_array_length(v_gaps),
      'gaps',v_gaps
    ),
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'duplicatesCanonicalState',false,
      'plannedIsNotObserved',true,
      'taskIsNotReality',true,
      'insufficientWarrantAllowed',true
    )
  );
end;
$function$;

revoke all on function atlas.reality_expression_packet_v1(uuid) from public;
revoke execute on function atlas.reality_expression_packet_v1(uuid) from anon;
revoke execute on function atlas.reality_expression_packet_v1(uuid) from authenticated;
grant execute on function atlas.reality_expression_packet_v1(uuid) to service_role;

comment on function atlas.reality_expression_packet_v1(uuid) is
  'Read-only Production Reality Adapter v1. Reconstructs a Production Lot reality packet from canonical production, event, seed-allocation, crop-lineage, destination/capacity-readiness, and task-link truth without writing duplicate state.';

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values (
  'atlas.reality_expression_packet_v1(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Read-only Phase 3 Production Reality Adapter for one canonical Production Lot.',
    'boundary','Service/internal projection only. It reads existing source, witness, state, flow/buffer, claims, readiness, lineage, and task-link truth and never writes duplicate state.',
    'truthLaw','Planned quantities are not substituted for unknown current quantities; missing custody, readiness, destination, lineage, or human carrier remains explicit insufficient warrant.'
  ),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;

commit;