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
as $function$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean;
  v_is_germination boolean:=false;
  v_is_direct_sow_seed boolean:=false;
  v_requires_structured boolean:=true;
  v_has_execution_checklist boolean:=false;
  v_result_contract jsonb;
begin
  v_card:=atlas.worker_state_transition_card_pre_or4_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  v_card:=atlas.worker_state_transition_planned_establishment_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);
  v_card:=atlas.worker_state_transition_followup_crop_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);
  v_card:=atlas.worker_state_transition_selection_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);

  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination:=atlas.is_germination_task_v1(v_task);
    v_is_direct_sow_seed:=coalesce(v_task.metadata->>'seed_governance_required','false')='true'
      and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
      and (coalesce(v_task.action_key,'')='sow' or coalesce(v_task.metadata->>'work_route','')='sow');
    v_requires_structured:=atlas.worker_task_requires_structured_result_v1(v_task.id);
    v_has_execution_checklist:=nullif(btrim(coalesce(v_task.metadata->>'execution_checklist_template_key','')),'') is not null;
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
    when coalesce(v_task.metadata->>'task_style','')='farm_round' or coalesce(v_task.action_key,'')='farm_round' then jsonb_build_object(
      'state','aggregate_member_completion_only','contractVersion','farm_round_member_completion_v1',
      'choices',jsonb_build_array('complete_members'),
      'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','Farm Round parent completion is derived from terminal member tasks; the parent has no direct Done result.'
    )
    when v_requires_structured and v_has_execution_checklist then jsonb_build_object(
      'state','execution_checklist_v1_available','contractVersion','execution_checklist_completion_v1','domainAdapter','execution_checklist_v1',
      'choices',jsonb_build_array('check_items','done','partial','blocked'),
      'requiredFields',jsonb_build_array('idempotencyKey'),
      'optionalFields',jsonb_build_array('note'),
      'principle','The task card checklist is the structured execution surface. Required physical components are recorded there; the final task transition closes the parent work without requiring a second domain adapter.',
      'doneInvariant','Required checklist components must be satisfied by the checklist-aware card before Done is offered; final completion reconciles task execution components through the canonical task transition.'
    )
    when v_requires_structured then jsonb_build_object(
      'state','structured_result_adapter_required','contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),'requiredFields','[]'::jsonb,'optionalFields','[]'::jsonb,
      'principle','This authorized operation needs a domain result adapter before generic Done is allowed.'
    )
    else jsonb_build_object(
      'state','quick_complete_v1_available','contractVersion','worker_quick_complete_v1',
      'choices',jsonb_build_array('done'),'requiredFields',jsonb_build_array('idempotencyKey'),'optionalFields',jsonb_build_array('note'),
      'transition','done','principle','This authorized operation may close through the canonical task transition because no additional domain witness fields are required.'
    )
  end;

  v_card:=jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card:=jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  v_card:=jsonb_set(v_card,'{truthBoundary,quickCompleteAuthority}',to_jsonb('canonical_result_return'::text),true);
  return v_card;
end;
$function$;
