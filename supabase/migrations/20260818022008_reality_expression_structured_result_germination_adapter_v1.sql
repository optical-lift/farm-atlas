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
  v_is_germination boolean := false;
  v_result_contract jsonb;
begin
  v_card := atlas.worker_state_transition_card_v1(p_farm_id,p_membership_id,p_task_id,p_service_date);
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id;
  if v_task.id is not null then
    v_is_germination := atlas.is_germination_task_v1(v_task);
  end if;
  v_authorized := coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day';

  v_result_contract := case
    when not v_authorized then jsonb_build_object(
      'state','operation_result_not_authorized',
      'contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),
      'requiredFields','[]'::jsonb,
      'optionalFields','[]'::jsonb,
      'principle','No result may be returned for an operation Reality Expression has not authorized.'
    )
    when v_is_germination then jsonb_build_object(
      'state','structured_result_v1_available',
      'contractVersion','worker_record_state_transition_result_v1',
      'domainAdapter','germination_observation_v2',
      'choices',jsonb_build_array('not_yet','beginning','germinated','failed_or_uncertain','problem_found'),
      'requiredFields',jsonb_build_array('actualMinutes','idempotencyKey'),
      'conditionalFields',jsonb_build_object(
        'germinated',jsonb_build_array('resultPayload.spacingOutcome'),
        'spacingOutcomeChoices',jsonb_build_array('thin','on_target','patch')
      ),
      'optionalFields',jsonb_build_array('quantity','unit','note','resultPayload.targetSpacingInches'),
      'doneInvariant','Germinated closes the task only inside the same transaction that records the operation actual and reclassifies the canonical crop-cycle state.',
      'observationInvariant','The worker returns the physical observation; Atlas derives task status, rhythm satisfaction, continuation, and any handoff from that observation.'
    )
    else jsonb_build_object(
      'state','structured_result_adapter_required',
      'contractVersion','worker_record_state_transition_result_v1',
      'choices',jsonb_build_array('inspect'),
      'requiredFields','[]'::jsonb,
      'optionalFields','[]'::jsonb,
      'principle','Phase 6 v1 is proven on the germination observation specimen. Other operations must receive a domain result adapter before generic Done is allowed.'
    )
  end;

  v_card := jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card := jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card := jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  return v_card;
end;
$function$;

create or replace function atlas.worker_record_state_transition_result_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_result text,
  p_actual_minutes integer,
  p_idempotency_key text,
  p_quantity numeric default null,
  p_unit text default null,
  p_note text default null,
  p_reason text default null,
  p_result_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_task atlas.tasks%rowtype;
  v_card jsonb;
  v_before jsonb;
  v_after jsonb;
  v_result text := lower(btrim(coalesce(p_result,'')));
  v_result_class text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_actual_key text;
  v_actual atlas.production_operation_actuals%rowtype;
  v_existing atlas.production_operation_actuals%rowtype;
  v_lot_id uuid;
  v_lot_count integer := 0;
  v_crop_count integer := 0;
  v_expected_minutes integer;
  v_reclassified boolean := false;
  v_raw jsonb;
  v_domain_result jsonb;
  v_spacing_outcome text;
  v_target_spacing numeric;
  v_workflow_event_id uuid;
  v_journal_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if p_actual_minutes is null or p_actual_minutes<=0 or p_actual_minutes>1440 then
    raise exception 'Actual minutes from 1 to 1440 are required for a structured operation result.' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>160 then
    raise exception 'A valid idempotency key is required.' using errcode='22023';
  end if;
  if p_result_payload is null or jsonb_typeof(p_result_payload)<>'object' then
    raise exception 'Result payload must be a JSON object.' using errcode='22023';
  end if;

  select * into v_membership
  from atlas.farm_memberships membership
  where membership.id=p_membership_id
    and membership.farm_id=p_farm_id
    and membership.active=true;
  if v_membership.id is null or v_membership.user_id is distinct from auth.uid() then
    raise exception 'Only the routed signed-in farm member may return this result.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id and task.farm_id=p_farm_id
  for update;
  if v_task.id is null then
    raise exception 'Task was not found on this farm.' using errcode='P0002';
  end if;

  v_actual_key := left('state-result:'||p_task_id::text||':'||md5(v_key),120);
  select * into v_existing
  from atlas.production_operation_actuals actual
  where actual.farm_id=p_farm_id and actual.idempotency_key=v_actual_key;
  if v_existing.id is not null then
    return jsonb_build_object(
      'contractVersion','worker_record_state_transition_result_v1',
      'deduplicated',true,
      'result',v_existing.result_payload->>'domainResult',
      'resultClass',v_existing.result_class,
      'operationActualId',v_existing.id,
      'taskId',p_task_id,
      'reconciliationState','previously_reconciled'
    );
  end if;

  v_card := atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  if coalesce(v_card #>> '{transition,state}','')<>'authorized_for_routed_day' then
    raise exception 'Reality Expression does not authorize this operation result: %',coalesce(v_card #>> '{transition,state}','unknown') using errcode='22023';
  end if;
  if coalesce(v_card #>> '{resultReturn,state}','')<>'structured_result_v1_available' then
    raise exception 'No structured result adapter is defined for this authorized operation in Phase 6 v1.' using errcode='22023';
  end if;
  if coalesce(v_card #>> '{resultReturn,domainAdapter}','')<>'germination_observation_v2' then
    raise exception 'Unsupported Phase 6 result adapter.' using errcode='22023';
  end if;
  if v_result not in ('not_yet','beginning','germinated','failed_or_uncertain','problem_found') then
    raise exception 'Choose not_yet, beginning, germinated, failed_or_uncertain, or problem_found.' using errcode='22023';
  end if;

  v_result_class := case
    when v_result='germinated' then 'done'
    when v_result in ('not_yet','beginning') then 'partial'
    else 'condition_differs'
  end;

  v_spacing_outcome := nullif(lower(btrim(coalesce(p_result_payload->>'spacingOutcome',''))),'');
  if v_result='germinated' and v_spacing_outcome not in ('thin','on_target','patch') then
    raise exception 'A germinated result requires resultPayload.spacingOutcome: thin, on_target, or patch.' using errcode='22023';
  end if;
  begin
    v_target_spacing := nullif(p_result_payload->>'targetSpacingInches','')::numeric;
  exception when invalid_text_representation then
    raise exception 'resultPayload.targetSpacingInches must be numeric when supplied.' using errcode='22023';
  end;

  v_before := atlas.task_reality_subject_snapshot_v1(p_task_id);
  if coalesce((v_before->>'subjectCount')::integer,0)=0 then
    raise exception 'A structured operation result requires at least one represented Reality Expression subject.' using errcode='22023';
  end if;

  select count(*)::integer,min(link.production_lot_id)
  into v_lot_count,v_lot_id
  from atlas.production_lot_tasks link
  where link.task_id=p_task_id;
  if v_lot_count<>1 then v_lot_id:=null; end if;

  select count(*)::integer into v_crop_count
  from atlas.task_crop_cycles link
  where link.task_id=p_task_id;

  select profile.expected_active_minutes into v_expected_minutes
  from atlas.task_capacity_profiles profile
  where profile.task_id=p_task_id;

  v_raw := jsonb_strip_nulls(jsonb_build_object(
    'domainResult',v_result,
    'resultClass',v_result_class,
    'actualMinutes',p_actual_minutes,
    'quantity',p_quantity,
    'unit',nullif(btrim(coalesce(p_unit,'')),''),
    'note',nullif(btrim(coalesce(p_note,'')),''),
    'reason',nullif(btrim(coalesce(p_reason,'')),''),
    'serviceDate',p_service_date,
    'workerPayload',p_result_payload
  ));

  insert into atlas.production_operation_actuals(
    farm_id,production_lot_id,task_id,operation_class,observed_date,actual_minutes,
    expected_minutes_before,quantity,unit,actor_membership_id,note,idempotency_key,
    metadata,result_class,result_payload
  ) values (
    p_farm_id,v_lot_id,p_task_id,coalesce(nullif(v_task.operation_class,''),nullif(v_task.action_key,''),'unclassified'),
    p_service_date,p_actual_minutes,v_expected_minutes,p_quantity,nullif(btrim(coalesce(p_unit,'')),''),
    p_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_actual_key,
    jsonb_build_object(
      'contractVersion','worker_record_state_transition_result_v1',
      'domainAdapter','germination_observation_v2',
      'actionKey',v_task.action_key,
      'cropCycleSubjectCount',v_crop_count,
      'productionLotSubjectCount',v_lot_count,
      'authorizedCardContract',v_card->>'contractVersion'
    ),v_result_class,v_raw
  ) returning * into v_actual;

  insert into atlas.production_operation_actual_crop_cycles(operation_actual_id,crop_cycle_id)
  select v_actual.id,link.crop_cycle_id
  from atlas.task_crop_cycles link
  where link.task_id=p_task_id
  on conflict (operation_actual_id,crop_cycle_id) do nothing;

  v_domain_result := atlas.record_germination_observation_for_member_v2(
    p_farm_id,
    p_task_id,
    v_task.title,
    v_result,
    v_spacing_outcome,
    v_target_spacing,
    p_note
  );

  v_after := atlas.task_reality_subject_snapshot_v1(p_task_id);
  v_reclassified := (v_after is distinct from v_before);
  if not v_reclassified then
    raise exception 'Structured result rejected: the canonical germination observation did not reclassify the linked Reality Expression subjects.' using errcode='P0001';
  end if;
  if v_result_class='done' and (select status from atlas.tasks where id=p_task_id)<>'done' then
    raise exception 'Done rejected: the domain adapter reclassified reality but did not close the completed task.' using errcode='P0001';
  end if;

  select we.id into v_workflow_event_id
  from atlas.workflow_events we
  where we.source_kind='crop_cycle'
    and we.source_id in (select crop_cycle_id from atlas.task_crop_cycles where task_id=p_task_id)
    and we.source_event='germination_observed:'||v_result
    and we.payload->>'taskId'=p_task_id::text
  order by we.created_at desc,we.id desc limit 1;

  if v_workflow_event_id is not null then
    select je.id into v_journal_event_id
    from atlas.journal_event_index je
    where je.source_workflow_event_id=v_workflow_event_id
    order by je.created_at desc limit 1;
  end if;

  return jsonb_build_object(
    'contractVersion','worker_record_state_transition_result_v1',
    'deduplicated',false,
    'result',v_result,
    'resultClass',v_result_class,
    'operationActualId',v_actual.id,
    'cropCycleSubjectCount',v_crop_count,
    'productionLotSubjectCount',v_lot_count,
    'domainResult',v_domain_result,
    'workflowEventId',v_workflow_event_id,
    'journalEventId',v_journal_event_id,
    'beforeReality',v_before,
    'afterReality',v_after,
    'reclassified',true,
    'reconciliationState',case
      when v_result_class='done' then 'reclassified_and_closed'
      when v_result_class='partial' then 'reclassified_and_continuing'
      else 'reclassified_and_handoff_or_reassessment'
    end,
    'nextState',jsonb_build_object(
      'taskStatus',(select status from atlas.tasks where id=p_task_id),
      'reality',v_after
    )
  );
end;
$function$;

update atlas.authenticated_rpc_registry
set evidence=coalesce(evidence,'{}'::jsonb)||jsonb_build_object(
      'phase6VerticalSpecimen','germination observation',
      'domainResultChoices',jsonb_build_array('not_yet','beginning','germinated','failed_or_uncertain','problem_found'),
      'domainAdapter','atlas.record_germination_observation_for_member_v2',
      'truthBoundary','Generic Done is not enabled for other operations. The crop-cycle observation is the fruit that reclassifies germination reality; task status is downstream.'
    ),
    reviewed_at=now()
where signature in (
  'atlas.worker_state_transition_card_v2(uuid, uuid, uuid, date)',
  'atlas.worker_record_state_transition_result_v1(uuid, uuid, uuid, date, text, integer, text, numeric, text, text, text, jsonb)'
);
