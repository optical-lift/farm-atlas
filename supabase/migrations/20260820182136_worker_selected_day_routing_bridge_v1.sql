create or replace function atlas.worker_state_transition_selection_bridge_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_card jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_card jsonb := coalesce(p_card,'{}'::jsonb);
  v_task atlas.tasks%rowtype;
  v_readiness jsonb;
  v_capacity record;
  v_selected boolean := false;
begin
  if p_service_date is null
     or coalesce(v_card#>>'{transition,state}','') <> 'not_routed'
     or coalesce(v_card#>>'{routing,state}','') <> 'not_placed_for_worker_day'
     or coalesce(nullif(v_card#>>'{currentReality,subjectCount}','')::integer,0) <> 0 then
    return v_card;
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id
    and task.farm_id=p_farm_id
    and task.status='open'
    and (
      task.assigned_membership_id=p_membership_id
      or task.metadata->>'executor_membership_id'=p_membership_id::text
    );

  if v_task.id is null then
    return v_card;
  end if;

  select exists(
    select 1
    from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_service_date) selection
    where selection.task_id=p_task_id
      and selection.presentation_state='presented'
      and coalesce(selection.overload,false)=false
  ) into v_selected;

  if not v_selected then
    return v_card;
  end if;

  v_readiness:=atlas.task_execution_readiness_v1(p_task_id);
  if not coalesce((v_readiness->>'ready')::boolean,false)
     or coalesce((v_card#>>'{clock,definiteCapacityConflict}')::boolean,false) then
    return v_card;
  end if;

  select cp.expected_active_minutes, cp.physical_load
  into v_capacity
  from atlas.task_capacity_plan_v1(v_task,p_service_date) cp;

  v_card:=jsonb_set(v_card,'{routing,state}',to_jsonb('selected_for_worker_day'::text),true);
  v_card:=jsonb_set(v_card,'{routing,selectionAuthority}',jsonb_build_object(
    'state','canonical_presented_selection',
    'serviceDate',p_service_date,
    'principle','Canonical Worker Day selection may establish same-day execution jurisdiction for zero-subject work when exact Clock placement has not yet been persisted.'
  ),true);
  v_card:=jsonb_set(v_card,'{jurisdiction,state}',to_jsonb('selected_body_established'::text),true);
  v_card:=jsonb_set(v_card,'{clock,selectionClaim}',jsonb_build_object(
    'state','presented_without_persisted_time_placement',
    'exactTimeClaim',false,
    'principle','Selection authorizes today ownership only; it does not invent an exact Clock start time.'
  ),true);
  v_card:=jsonb_set(v_card,'{transition,state}',to_jsonb('authorized_for_routed_day'::text),true);
  v_card:=jsonb_set(v_card,'{transition,authorizedInstruction}',jsonb_strip_nulls(jsonb_build_object(
    'actionKey',v_task.action_key,
    'operationClass',v_task.operation_class,
    'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
    'doneWhen',nullif(v_task.metadata->>'execution_done_when',''),
    'dayWindow',atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata),
    'plannedStartAt',null,
    'plannedDurationMinutes',v_capacity.expected_active_minutes
  )),true);
  v_card:=jsonb_set(v_card,'{truthBoundary,selectedDayBridge}',jsonb_build_object(
    'zeroSubjectOnly',true,
    'requiresCanonicalPresentedSelection',true,
    'requiresExecutionReadiness',true,
    'requiresNoDefiniteCapacityConflict',true,
    'doesNotCreateClockPlacement',true,
    'doesNotBypassCropOrProductionReality',true
  ),true);

  return v_card;
end;
$$;

revoke all on function atlas.worker_state_transition_selection_bridge_v1(uuid,uuid,uuid,date,jsonb) from public, anon, authenticated;
grant execute on function atlas.worker_state_transition_selection_bridge_v1(uuid,uuid,uuid,date,jsonb) to service_role;

create or replace function atlas.worker_state_transition_card_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean;
  v_is_germination boolean:=false;
  v_is_direct_sow_seed boolean:=false;
  v_result_contract jsonb;
begin
  v_card:=atlas.worker_state_transition_card_pre_or4_v2(
    p_farm_id,p_membership_id,p_task_id,p_service_date
  );
  v_card:=atlas.worker_state_transition_selection_bridge_v1(
    p_farm_id,p_membership_id,p_task_id,p_service_date,v_card
  );

  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination:=atlas.is_germination_task_v1(v_task);
    v_is_direct_sow_seed:=coalesce(v_task.metadata->>'seed_governance_required','false')='true'
      and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
      and (coalesce(v_task.action_key,'')='sow' or coalesce(v_task.metadata->>'work_route','')='sow');
  end if;
  v_authorized:=coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day';

  v_result_contract:=case
    when not v_authorized then jsonb_build_object(
      'state','operation_result_not_authorized','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','No result may be returned for an operation Reality Expression has not authorized.'
    )
    when v_is_germination then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','worker_record_state_transition_result_v1','domainAdapter','germination_observation_v2',
      'choices',jsonb_build_array('not_yet','beginning','germinated','failed_or_uncertain','problem_found'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('germinated',jsonb_build_array('resultPayload.spacingOutcome'),'spacingOutcomeChoices',jsonb_build_array('thin','on_target','patch')),
      'optionalFields',jsonb_build_array('quantity','unit','note','resultPayload.targetSpacingInches'),
      'doneInvariant','Germinated closes the task only inside the same transaction that records the operation actual and reclassifies the canonical crop-cycle state.',
      'observationInvariant','The worker returns the physical observation; Atlas derives task status, rhythm satisfaction, continuation, and any handoff from that observation.'
    )
    when v_is_direct_sow_seed then jsonb_build_object(
      'state','structured_result_v1_available','contractVersion','record_direct_sow_seed_result_for_member_v1','domainAdapter','direct_sow_seed_v1',
      'choices',jsonb_build_array('depleted','exact_remaining','some_left_unknown'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object('exact_remaining',jsonb_build_array('remainingQuantity')),
      'optionalFields',jsonb_build_array('note'),
      'doneInvariant','The sowing task closes only after the seed remainder event is recorded and the canonical seed state is reclassified in the same transaction.',
      'observationInvariant','Report only what is physically known after sowing: none left, an exact remaining count, or some left but unmeasured. Atlas must not infer an exact balance from task completion.'
    )
    else jsonb_build_object(
      'state','structured_result_adapter_required','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','This authorized operation needs a domain result adapter before generic Done is allowed.'
    )
  end;

  v_card:=jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card:=jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  return v_card;
end;
$$;
