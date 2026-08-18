create or replace function atlas.worker_state_transition_card_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_target atlas.farm_memberships%rowtype;
  v_task atlas.tasks%rowtype;
  v_placement atlas.worker_day_task_placements%rowtype;
  v_is_management boolean := false;
  v_executor_membership_id uuid;
  v_routing_state text := 'not_routed';
  v_crop_subjects jsonb := '[]'::jsonb;
  v_production_subjects jsonb := '[]'::jsonb;
  v_crop_count integer := 0;
  v_production_count integer := 0;
  v_resolution_count integer := 0;
  v_identity_mismatch_count integer := 0;
  v_rec record;
  v_packet jsonb;
  v_issue_keys jsonb;
  v_attention_count integer;
  v_fit_state text;
  v_fit_function text;
  v_fit_current_task_id uuid;
  v_availability_state text;
  v_capacity jsonb;
  v_placed_minutes integer := 0;
  v_maximum_usable_minutes integer;
  v_definite_capacity_conflict boolean := false;
  v_transition_state text;
  v_authorized_instruction jsonb := null;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  select * into v_target
  from atlas.farm_memberships membership
  where membership.id=p_membership_id
    and membership.farm_id=p_farm_id
    and membership.active=true;

  if v_target.id is null then
    raise exception 'Active target membership required.' using errcode='42501';
  end if;

  v_is_management := atlas.is_farm_manager_or_owner(p_farm_id);
  if v_target.user_id is distinct from auth.uid() and not v_is_management then
    raise exception 'Only the routed worker or farm management may read this transition card.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id and task.farm_id=p_farm_id;

  if v_task.id is null then
    raise exception 'Task was not found on this farm.' using errcode='P0002';
  end if;

  begin
    v_executor_membership_id := nullif(v_task.metadata->>'executor_membership_id','')::uuid;
  exception when invalid_text_representation then
    v_executor_membership_id := null;
  end;

  select * into v_placement
  from atlas.worker_day_task_placements placement
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.task_id=p_task_id
    and placement.service_date=p_service_date
    and placement.state='placed'
  order by placement.updated_at desc, placement.created_at desc
  limit 1;

  if v_placement.id is null then
    v_routing_state := 'not_placed_for_worker_day';
  elsif v_task.assigned_membership_id is not null
        and v_task.assigned_membership_id is distinct from p_membership_id
        and v_executor_membership_id is distinct from p_membership_id then
    v_routing_state := 'placement_assignment_conflict';
  else
    v_routing_state := 'routed_to_membership';
  end if;

  for v_rec in
    select cc.id,cc.crop_cycle_key,cc.crop_label,cc.variety,cc.cycle_state,cc.lifecycle_status,cc.object_id
    from atlas.task_crop_cycles link
    join atlas.crop_cycles cc on cc.id=link.crop_cycle_id
    where link.task_id=p_task_id
    order by cc.crop_label,cc.variety,cc.id
  loop
    v_crop_count := v_crop_count + 1;
    v_packet := atlas.crop_cycle_reality_expression_v3(v_rec.id);
    v_fit_state := coalesce(v_packet #>> '{fittingOperation,state}','unresolved');
    v_fit_function := nullif(v_packet #>> '{fittingOperation,operationClass}','');
    begin
      v_fit_current_task_id := nullif(v_packet #>> '{fittingOperation,currentTaskId}','')::uuid;
    exception when invalid_text_representation then
      v_fit_current_task_id := null;
    end;

    select
      coalesce(jsonb_agg(to_jsonb(issue->>'key') order by issue->>'key'),'[]'::jsonb),
      count(*) filter (where coalesce(issue->>'severity','')='attention')::integer
    into v_issue_keys,v_attention_count
    from jsonb_array_elements(coalesce(v_packet->'issues','[]'::jsonb)) issue;

    if v_fit_state not in ('available','required') then
      v_resolution_count := v_resolution_count + 1;
    end if;
    if v_fit_current_task_id is distinct from v_task.id then
      v_identity_mismatch_count := v_identity_mismatch_count + 1;
    end if;

    v_crop_subjects := v_crop_subjects || jsonb_build_array(jsonb_build_object(
      'subjectType','crop_cycle',
      'id',v_rec.id,
      'stableKey',v_rec.crop_cycle_key,
      'label',v_rec.crop_label,
      'variety',v_rec.variety,
      'cycleState',v_rec.cycle_state,
      'lifecycleStatus',v_rec.lifecycle_status,
      'objectId',v_rec.object_id,
      'realityContractVersion',v_packet->>'contractVersion',
      'fittingOperation',coalesce(v_packet->'fittingOperation','{}'::jsonb),
      'operationIdentity',jsonb_build_object(
        'state',case when v_fit_current_task_id=v_task.id then 'canonical_current_task_match' else 'not_established' end,
        'currentTaskId',v_fit_current_task_id
      ),
      'attentionIssueCount',coalesce(v_attention_count,0),
      'issueKeys',v_issue_keys
    ));
  end loop;

  for v_rec in
    select lot.id,lot.stable_key,lot.lot_label,lot.lifecycle_status,lot.current_stage
    from atlas.production_lot_tasks link
    join atlas.production_lots lot on lot.id=link.production_lot_id
    where link.task_id=p_task_id
    order by lot.stable_key,lot.id
  loop
    v_production_count := v_production_count + 1;
    v_packet := atlas.reality_expression_packet_v2(v_rec.id);
    v_availability_state := coalesce(v_packet #>> '{flowBufferClaim,nextTransitionAvailability,state}','not_available');
    v_fit_function := nullif(v_packet #>> '{flowBufferClaim,nextTransitionAvailability,operationFunction}','');

    if v_availability_state not in ('available_for_routing_unclaimed','claimed_for_execution_capacity_fit_unverified') then
      v_resolution_count := v_resolution_count + 1;
    end if;
    if v_fit_function is distinct from v_task.action_key then
      v_identity_mismatch_count := v_identity_mismatch_count + 1;
    end if;

    v_production_subjects := v_production_subjects || jsonb_build_array(jsonb_build_object(
      'subjectType','production_lot',
      'id',v_rec.id,
      'stableKey',v_rec.stable_key,
      'label',v_rec.lot_label,
      'lifecycleStatus',v_rec.lifecycle_status,
      'currentStage',v_rec.current_stage,
      'realityContractVersion',v_packet->>'contractVersion',
      'availabilityState',v_availability_state,
      'fittingFunction',v_fit_function,
      'reasons',coalesce(v_packet #> '{flowBufferClaim,nextTransitionAvailability,reasons}','[]'::jsonb)
    ));
  end loop;

  v_capacity := atlas.worker_week_day_capacity_v1(p_farm_id,p_membership_id,p_service_date);
  select coalesce(sum(coalesce(placement.planned_duration_minutes,0)),0)::integer
  into v_placed_minutes
  from atlas.worker_day_task_placements placement
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_service_date
    and placement.state='placed';

  begin
    v_maximum_usable_minutes := nullif(v_capacity->>'maximumUsableMinutes','')::integer;
  exception when invalid_text_representation then
    v_maximum_usable_minutes := null;
  end;

  v_definite_capacity_conflict :=
    coalesce(v_capacity->>'state','') in ('unavailable','non_working_day','policy_conflict')
    or (v_maximum_usable_minutes is not null and v_placed_minutes>v_maximum_usable_minutes);

  v_transition_state := case
    when v_routing_state='not_placed_for_worker_day' then 'not_routed'
    when v_routing_state='placement_assignment_conflict' then 'routing_conflict'
    when v_task.status<>'open' then 'task_not_open'
    when v_crop_count+v_production_count=0 then 'reality_subject_unrepresented'
    when v_resolution_count>0 then 'reality_resolution_required'
    when v_identity_mismatch_count>0 then 'operation_identity_unresolved'
    when v_definite_capacity_conflict then 'clock_capacity_conflict'
    else 'authorized_for_routed_day'
  end;

  if v_transition_state='authorized_for_routed_day' then
    v_authorized_instruction := jsonb_strip_nulls(jsonb_build_object(
      'actionKey',v_task.action_key,
      'operationClass',v_task.operation_class,
      'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
      'doneWhen',nullif(v_task.metadata->>'execution_done_when',''),
      'dayWindow',v_placement.day_window,
      'plannedStartAt',v_placement.planned_start_at,
      'plannedDurationMinutes',v_placement.planned_duration_minutes
    ));
  end if;

  return jsonb_build_object(
    'contractVersion','worker_state_transition_card_v1',
    'task',jsonb_build_object(
      'id',v_task.id,
      'title',v_task.title,
      'status',v_task.status,
      'taskType',v_task.task_type,
      'actionKey',v_task.action_key,
      'operationClass',v_task.operation_class,
      'taskProposal',jsonb_strip_nulls(jsonb_build_object(
        'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
        'doneWhen',nullif(v_task.metadata->>'execution_done_when','')
      ))
    ),
    'routing',jsonb_build_object(
      'state',v_routing_state,
      'membershipId',p_membership_id,
      'membershipRole',v_target.role,
      'serviceDate',p_service_date,
      'placementId',v_placement.id,
      'dayWindow',v_placement.day_window,
      'plannedStartAt',v_placement.planned_start_at,
      'plannedDurationMinutes',v_placement.planned_duration_minutes,
      'taskAssignedMembershipId',v_task.assigned_membership_id,
      'taskExecutorMembershipId',v_executor_membership_id,
      'principle','Placement routes a human body and claims time; it does not create the underlying reality or prove that the proposed operation fits it.'
    ),
    'currentReality',jsonb_build_object(
      'cropCycles',v_crop_subjects,
      'productionLots',v_production_subjects,
      'subjectCount',v_crop_count+v_production_count,
      'resolutionRequiredSubjectCount',v_resolution_count,
      'principle','The task is a carrier into the Worker Day. Canonical crop and Production subjects remain the reality controls when represented.'
    ),
    'fittingFunction',jsonb_build_object(
      'taskProposedActionKey',v_task.action_key,
      'taskProposedOperationClass',v_task.operation_class,
      'exactIdentityMismatchCount',v_identity_mismatch_count,
      'state',case
        when v_crop_count+v_production_count=0 then 'unrepresented'
        when v_resolution_count>0 then 'resolution_required'
        when v_identity_mismatch_count>0 then 'identity_unresolved'
        else 'exact_identity_supported'
      end,
      'principle','Task labels are not identity proof. For Crop Reality, the canonical fitting-operation currentTaskId establishes operation identity; functional operationClass remains a separate vocabulary.'
    ),
    'jurisdiction',jsonb_build_object(
      'state',case when v_routing_state='routed_to_membership' then 'routed_body_established' else 'not_established' end,
      'membershipId',p_membership_id,
      'membershipRole',v_target.role,
      'managementPreview',v_is_management,
      'principle','Routing establishes who may carry the work; it does not grant the worker authority to adjudicate missing reality, spatial relations, claims, or provenance.'
    ),
    'clock',jsonb_build_object(
      'placementClaim',case when v_placement.id is null then 'none' else 'present' end,
      'dayCapacity',v_capacity,
      'placedTaskMinutes',v_placed_minutes,
      'definiteCapacityConflict',v_definite_capacity_conflict,
      'sequenceAuthority','not_evaluated_in_phase5_v1',
      'principle','This card preserves the existing Clock claim and definite conflicts but does not infer immediate sequence or total-day fit from a placement alone.'
    ),
    'transition',jsonb_build_object(
      'state',v_transition_state,
      'authorizedInstruction',v_authorized_instruction,
      'workerMustNotInfer',jsonb_build_array(
        'missing physical state',
        'unresolved spatial relation',
        'unrepresented claim',
        'operation identity',
        'management adjudication',
        'result meaning'
      )
    ),
    'resultReturn',jsonb_build_object(
      'state','phase6_contract_not_yet_defined',
      'existingTaskOutcomeRailPresent',true,
      'principle','Phase 5 identifies the transition and its jurisdiction. Phase 6 will define the structured fruit/evidence that may reclassify reality.'
    ),
    'truthBoundary',jsonb_build_object(
      'readOnly',true,
      'taskIsNotSourceOfReality',true,
      'placementIsRoutingNotReality',true,
      'assignmentIsNotOperationWarrant',true,
      'unresolvedRealityCannotYieldAuthorizedInstruction',true,
      'resultContractDeferredToPhase6',true
    )
  );
end;
$function$;

revoke all on function atlas.worker_state_transition_card_v1(uuid,uuid,uuid,date) from public;
revoke all on function atlas.worker_state_transition_card_v1(uuid,uuid,uuid,date) from anon;
grant execute on function atlas.worker_state_transition_card_v1(uuid,uuid,uuid,date) to authenticated;
grant execute on function atlas.worker_state_transition_card_v1(uuid,uuid,uuid,date) to service_role;

update atlas.authenticated_rpc_registry
set evidence = coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
      'cropOperationIdentity','Crop Reality currentTaskId is the canonical task-identity proof; operationClass is preserved as functional vocabulary rather than compared to action_key.',
      'cropTimingWarrant','available|required may authorize the released crop operation; unresolved|not_yet|state_known_timing_unresolved|failure_boundary_crossed require further state handling.'
    ),
    reviewed_at=now()
where signature='atlas.worker_state_transition_card_v1(uuid, uuid, uuid, date)';
