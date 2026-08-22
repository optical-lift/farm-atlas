create or replace function atlas.worker_state_transition_planned_establishment_bridge_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_card jsonb
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb := coalesce(p_card,'{}'::jsonb);
  v_task atlas.tasks%rowtype;
  v_readiness jsonb;
  v_selected boolean := false;
  v_total_cycles integer := 0;
  v_exact_planned_cycles integer := 0;
  v_active_conflicts integer := 0;
  v_production_lots integer := 0;
  v_capacity record;
  v_crop_subjects jsonb := '[]'::jsonb;
  v_routing_state text;
begin
  if p_service_date is null then return v_card; end if;
  if coalesce(v_card#>>'{transition,state}','') = 'authorized_for_routed_day' then return v_card; end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id
    and task.farm_id=p_farm_id
    and task.status='open'
    and (task.assigned_membership_id=p_membership_id or task.metadata->>'executor_membership_id'=p_membership_id::text);
  if v_task.id is null then return v_card; end if;

  if coalesce(v_task.action_key,'') <> 'sow'
     or coalesce(v_task.operation_class,'') <> 'establish_aboveground' then
    return v_card;
  end if;

  select count(*)::integer,
         count(*) filter (
           where cc.lifecycle_status='planned'
             and cc.cycle_state='planned'
             and cc.source_task_id=p_task_id
         )::integer,
         count(*) filter (
           where exists (
             select 1
             from atlas.crop_cycles other
             where other.object_id=cc.object_id
               and other.id<>cc.id
               and other.lifecycle_status='active'
           )
         )::integer
  into v_total_cycles,v_exact_planned_cycles,v_active_conflicts
  from atlas.task_crop_cycles link
  join atlas.crop_cycles cc on cc.id=link.crop_cycle_id
  where link.task_id=p_task_id;

  if v_total_cycles=0 or v_exact_planned_cycles<>v_total_cycles or v_active_conflicts>0 then return v_card; end if;

  select count(*)::integer into v_production_lots
  from atlas.production_lot_tasks link
  where link.task_id=p_task_id;
  if v_production_lots>0 then return v_card; end if;

  v_readiness:=atlas.task_execution_readiness_v1(p_task_id);
  if not coalesce((v_readiness->>'ready')::boolean,false)
     or coalesce((v_card#>>'{clock,definiteCapacityConflict}')::boolean,false) then
    return v_card;
  end if;

  v_routing_state:=coalesce(v_card#>>'{routing,state}','');
  if v_routing_state='not_placed_for_worker_day' then
    select exists(
      select 1
      from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_service_date) selection
      where selection.task_id=p_task_id
        and selection.presentation_state='presented'
        and coalesce(selection.overload,false)=false
    ) into v_selected;
    if not v_selected then return v_card; end if;

    select cp.expected_active_minutes, cp.physical_load
    into v_capacity
    from atlas.task_capacity_plan_v1(v_task,p_service_date) cp;

    v_card:=jsonb_set(v_card,'{routing,state}',to_jsonb('selected_for_worker_day'::text),true);
    v_card:=jsonb_set(v_card,'{routing,selectionAuthority}',jsonb_build_object(
      'state','canonical_presented_selection',
      'serviceDate',p_service_date,
      'principle','Canonical Worker Day selection establishes same-day execution jurisdiction for an exact planned establishment whose crop cycles name this task as their source.'
    ),true);
    v_card:=jsonb_set(v_card,'{jurisdiction,state}',to_jsonb('selected_body_established'::text),true);
    v_card:=jsonb_set(v_card,'{clock,selectionClaim}',jsonb_build_object(
      'state','presented_without_persisted_time_placement','exactTimeClaim',false,
      'principle','Selection authorizes today ownership only; it does not invent an exact Clock start time.'
    ),true);
  elsif v_routing_state <> 'routed_to_membership' then
    return v_card;
  end if;

  select coalesce(jsonb_agg(
    jsonb_set(
      jsonb_set(subject,'{fittingOperation}',jsonb_build_object(
        'state','available',
        'operationClass',v_task.operation_class,
        'source','planned_crop_cycle_source_task',
        'currentTaskId',p_task_id
      ),true),
      '{operationIdentity}',jsonb_build_object(
        'state','canonical_source_task_match',
        'currentTaskId',p_task_id,
        'source','crop_cycle.source_task_id'
      ),true
    ) order by subject->>'id'
  ),'[]'::jsonb)
  into v_crop_subjects
  from jsonb_array_elements(coalesce(v_card#>'{currentReality,cropCycles}','[]'::jsonb)) subject;

  v_card:=jsonb_set(v_card,'{currentReality,cropCycles}',v_crop_subjects,true);
  v_card:=jsonb_set(v_card,'{currentReality,resolutionRequiredSubjectCount}','0'::jsonb,true);
  v_card:=jsonb_set(v_card,'{fittingFunction,state}',to_jsonb('exact_identity_supported'::text),true);
  v_card:=jsonb_set(v_card,'{fittingFunction,exactIdentityMismatchCount}','0'::jsonb,true);
  v_card:=jsonb_set(v_card,'{transition,state}',to_jsonb('authorized_for_routed_day'::text),true);
  v_card:=jsonb_set(v_card,'{transition,authorizedInstruction}',jsonb_strip_nulls(jsonb_build_object(
    'actionKey',v_task.action_key,
    'operationClass',v_task.operation_class,
    'do',coalesce(nullif(v_task.metadata->>'execution_do',''),v_task.title),
    'doneWhen',nullif(v_task.metadata->>'execution_done_when',''),
    'dayWindow',coalesce(nullif(v_card#>>'{routing,dayWindow}',''),atlas.worker_task_day_window_v1(v_task.action_key,v_task.task_type,v_task.metadata)),
    'plannedStartAt',nullif(v_card#>>'{routing,plannedStartAt}',''),
    'plannedDurationMinutes',case when v_routing_state='routed_to_membership' then nullif(v_card#>>'{routing,plannedDurationMinutes}','')::integer else v_capacity.expected_active_minutes end
  )),true);
  v_card:=jsonb_set(v_card,'{truthBoundary,plannedEstablishmentBridge}',jsonb_build_object(
    'requiresPlannedCropCycles',true,
    'requiresExactSourceTaskIdentity',true,
    'requiresNoActiveDestinationConflict',true,
    'requiresExecutionReadiness',true,
    'requiresCanonicalPresentedSelectionWhenUnplaced',true,
    'doesNotAuthorizeLaterCropOperations',true,
    'doesNotInferPhysicalCompletion',true
  ),true);

  return v_card;
end;
$function$;

revoke all on function atlas.worker_state_transition_planned_establishment_bridge_v1(uuid,uuid,uuid,date,jsonb) from public, anon, authenticated;

create or replace function atlas.worker_state_transition_card_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_card jsonb;
  v_task atlas.tasks%rowtype;
  v_authorized boolean;
  v_is_germination boolean:=false;
  v_is_direct_sow_seed boolean:=false;
  v_requires_structured boolean:=true;
  v_result_contract jsonb;
begin
  v_card:=atlas.worker_state_transition_card_pre_or4_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  v_card:=atlas.worker_state_transition_selection_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);
  v_card:=atlas.worker_state_transition_planned_establishment_bridge_v1(p_farm_id,p_membership_id,p_task_id,p_service_date,v_card);

  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination:=atlas.is_germination_task_v1(v_task);
    v_is_direct_sow_seed:=coalesce(v_task.metadata->>'seed_governance_required','false')='true'
      and coalesce(v_task.metadata->>'seed_inventory_report_required','false')='true'
      and (coalesce(v_task.action_key,'')='sow' or coalesce(v_task.metadata->>'work_route','')='sow');
    v_requires_structured:=atlas.worker_task_requires_structured_result_v1(v_task.id);
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

update atlas.authenticated_rpc_registry
set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'plannedEstablishmentIdentity','For initial sowing only, exact planned crop cycles whose source_task_id is the current sow task provide canonical establishment identity; later crop operations still require their own Reality Expression current operation.',
      'plannedEstablishmentSelection','An unplaced establishment may use canonical presented Worker Day selection only when every linked crop cycle is planned, source-linked to the task, has no active destination conflict, and execution readiness is true.'
    ),
    reviewed_at=now()
where signature='atlas.worker_state_transition_card_v2(uuid, uuid, uuid, date)';