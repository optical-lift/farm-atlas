alter table atlas.production_operation_actuals
  add column if not exists result_class text not null default 'done',
  add column if not exists result_payload jsonb not null default '{}'::jsonb;

do $do$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='atlas.production_operation_actuals'::regclass
      and conname='production_operation_actuals_result_class_check'
  ) then
    alter table atlas.production_operation_actuals
      add constraint production_operation_actuals_result_class_check
      check (result_class in ('done','partial','blocked','condition_differs'));
  end if;
end
$do$;

create table if not exists atlas.production_operation_actual_crop_cycles (
  id uuid primary key default gen_random_uuid(),
  operation_actual_id uuid not null references atlas.production_operation_actuals(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  relation_role text not null default 'operation_subject',
  created_at timestamptz not null default now(),
  unique(operation_actual_id,crop_cycle_id)
);

create index if not exists production_operation_actual_crop_cycles_cycle_idx
  on atlas.production_operation_actual_crop_cycles(crop_cycle_id,created_at desc);

alter table atlas.production_operation_actual_crop_cycles enable row level security;
revoke all on table atlas.production_operation_actual_crop_cycles from public;
revoke all on table atlas.production_operation_actual_crop_cycles from anon;
revoke all on table atlas.production_operation_actual_crop_cycles from authenticated;
grant all on table atlas.production_operation_actual_crop_cycles to service_role;

create or replace function atlas.task_reality_subject_snapshot_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_crop jsonb := '[]'::jsonb;
  v_lots jsonb := '[]'::jsonb;
begin
  select * into v_task from atlas.tasks where id=p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode='P0002';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',cc.id,
    'cropCycleKey',cc.crop_cycle_key,
    'state',packet #> '{witnesses,currentState}',
    'fittingOperation',packet->'fittingOperation',
    'continuity',packet->'continuity',
    'issues',packet->'issues'
  ) order by cc.id),'[]'::jsonb)
  into v_crop
  from atlas.task_crop_cycles link
  join atlas.crop_cycles cc on cc.id=link.crop_cycle_id
  cross join lateral (select atlas.crop_cycle_reality_expression_v4(cc.id) as packet) p;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id',lot.id,
    'stableKey',lot.stable_key,
    'packet',packet - 'asOf'
  ) order by lot.id),'[]'::jsonb)
  into v_lots
  from atlas.production_lot_tasks link
  join atlas.production_lots lot on lot.id=link.production_lot_id
  cross join lateral (select atlas.reality_expression_packet_v2(lot.id) as packet) p;

  return jsonb_build_object(
    'taskId',v_task.id,
    'taskStatus',v_task.status,
    'cropCycles',v_crop,
    'productionLots',v_lots,
    'subjectCount',jsonb_array_length(v_crop)+jsonb_array_length(v_lots)
  );
end;
$function$;

revoke all on function atlas.task_reality_subject_snapshot_v1(uuid) from public;
revoke all on function atlas.task_reality_subject_snapshot_v1(uuid) from anon;
revoke all on function atlas.task_reality_subject_snapshot_v1(uuid) from authenticated;
grant execute on function atlas.task_reality_subject_snapshot_v1(uuid) to service_role;

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
  v_authorized boolean;
  v_result_contract jsonb;
begin
  v_card := atlas.worker_state_transition_card_v1(p_farm_id,p_membership_id,p_task_id,p_service_date);
  v_authorized := coalesce(v_card #>> '{transition,state}','')='authorized_for_routed_day';

  v_result_contract := jsonb_build_object(
    'state',case when v_authorized then 'structured_result_v1_available' else 'operation_result_not_authorized' end,
    'contractVersion','worker_record_state_transition_result_v1',
    'choices',case when v_authorized then jsonb_build_array('done','partial','blocked','condition_differs') else jsonb_build_array('inspect') end,
    'requiredFields',case when v_authorized then jsonb_build_array('actualMinutes','idempotencyKey') else '[]'::jsonb end,
    'optionalFields',case when v_authorized then jsonb_build_array('quantity','unit','note','reason','resultPayload') else '[]'::jsonb end,
    'doneInvariant','Done is accepted only after a structured operation actual is recorded and the underlying Reality Expression subjects reclassify inside the same transaction.',
    'blockedInvariant','Blocked and condition-differs preserve the witness without granting the worker authority to adjudicate the cause or destination.'
  );

  v_card := jsonb_set(v_card,'{contractVersion}',to_jsonb('worker_state_transition_card_v2'::text),true);
  v_card := jsonb_set(v_card,'{resultReturn}',v_result_contract,true);
  v_card := jsonb_set(v_card,'{truthBoundary,resultContractDeferredToPhase6}','false'::jsonb,true);
  return v_card;
end;
$function$;

revoke all on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) from public;
revoke all on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) from anon;
grant execute on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) to authenticated;
grant execute on function atlas.worker_state_transition_card_v2(uuid,uuid,uuid,date) to service_role;

create or replace function atlas.worker_day_state_transition_cards_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_service_date date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_target atlas.farm_memberships%rowtype;
  v_is_management boolean := false;
  v_cards jsonb := '[]'::jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;

  select * into v_target
  from atlas.farm_memberships membership
  where membership.id=p_membership_id and membership.farm_id=p_farm_id and membership.active=true;
  if v_target.id is null then
    raise exception 'Active target membership required.' using errcode='42501';
  end if;

  v_is_management := atlas.is_farm_manager_or_owner(p_farm_id);
  if v_target.user_id is distinct from auth.uid() and not v_is_management then
    raise exception 'Only the routed worker or farm management may read this Worker Day transition packet.' using errcode='42501';
  end if;

  select coalesce(jsonb_agg(
    atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,placement.task_id,p_service_date)
    order by case placement.day_window when 'morning' then 0 when 'afternoon' then 1 when 'evening' then 2 else 3 end,
             placement.sort_order,placement.created_at
  ),'[]'::jsonb)
  into v_cards
  from atlas.worker_day_task_placements placement
  where placement.farm_id=p_farm_id
    and placement.membership_id=p_membership_id
    and placement.service_date=p_service_date
    and placement.state='placed';

  return jsonb_build_object(
    'contractVersion','worker_day_state_transition_cards_v2',
    'farmId',p_farm_id,
    'membershipId',p_membership_id,
    'serviceDate',p_service_date,
    'cards',v_cards,
    'integrationState','phase6_structured_result_parallel_to_legacy_worker_day',
    'principle','Worker Day may now return structured fruit through Reality Expression without making the task or placement the source of truth.'
  );
end;
$function$;

revoke all on function atlas.worker_day_state_transition_cards_v2(uuid,uuid,date) from public;
revoke all on function atlas.worker_day_state_transition_cards_v2(uuid,uuid,date) from anon;
grant execute on function atlas.worker_day_state_transition_cards_v2(uuid,uuid,date) to authenticated;
grant execute on function atlas.worker_day_state_transition_cards_v2(uuid,uuid,date) to service_role;

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
  v_transition text;
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_actual_key text;
  v_transition_key text;
  v_actual atlas.production_operation_actuals%rowtype;
  v_existing atlas.production_operation_actuals%rowtype;
  v_transition_result jsonb;
  v_outcome_event_id uuid;
  v_workflow_event_id uuid;
  v_journal_event_id uuid;
  v_lot_id uuid;
  v_lot_count integer := 0;
  v_crop_count integer := 0;
  v_expected_minutes integer;
  v_reclassified boolean := false;
  v_reason text;
  v_raw jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'A service date is required.' using errcode='22023';
  end if;
  if v_result not in ('done','partial','blocked','condition_differs') then
    raise exception 'Result must be done, partial, blocked, or condition_differs.' using errcode='22023';
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
  v_transition_key := left('state-result-transition:'||p_task_id::text||':'||md5(v_key),160);

  select * into v_existing
  from atlas.production_operation_actuals actual
  where actual.farm_id=p_farm_id and actual.idempotency_key=v_actual_key;
  if v_existing.id is not null then
    select tt.task_outcome_event_id into v_outcome_event_id
    from atlas.task_transitions tt
    where tt.task_id=p_task_id and tt.idempotency_key=v_transition_key
    order by tt.created_at desc limit 1;
    select we.id into v_workflow_event_id
    from atlas.workflow_events we
    where we.payload->>'task_outcome_event_id'=v_outcome_event_id::text
    order by we.created_at desc limit 1;
    select je.id into v_journal_event_id
    from atlas.journal_event_index je
    where je.source_workflow_event_id=v_workflow_event_id
    order by je.created_at desc limit 1;
    return jsonb_build_object(
      'contractVersion','worker_record_state_transition_result_v1',
      'deduplicated',true,
      'result',v_existing.result_class,
      'operationActualId',v_existing.id,
      'taskId',p_task_id,
      'taskOutcomeEventId',v_outcome_event_id,
      'workflowEventId',v_workflow_event_id,
      'journalEventId',v_journal_event_id
    );
  end if;

  v_card := atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  if coalesce(v_card #>> '{transition,state}','')<>'authorized_for_routed_day' then
    raise exception 'Reality Expression does not authorize this operation result: %',coalesce(v_card #>> '{transition,state}','unknown') using errcode='22023';
  end if;

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

  v_reason := case
    when v_result='condition_differs' then coalesce(nullif(btrim(coalesce(p_reason,'')),''),'Observed condition differs from the authorized instruction.')
    else nullif(btrim(coalesce(p_reason,'')),'')
  end;

  v_raw := jsonb_strip_nulls(jsonb_build_object(
    'result',v_result,
    'actualMinutes',p_actual_minutes,
    'quantity',p_quantity,
    'unit',nullif(btrim(coalesce(p_unit,'')),''),
    'note',nullif(btrim(coalesce(p_note,'')),''),
    'reason',v_reason,
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
      'actionKey',v_task.action_key,
      'cropCycleSubjectCount',v_crop_count,
      'productionLotSubjectCount',v_lot_count,
      'authorizedCardContract',v_card->>'contractVersion'
    ),v_result,v_raw
  ) returning * into v_actual;

  insert into atlas.production_operation_actual_crop_cycles(operation_actual_id,crop_cycle_id)
  select v_actual.id,link.crop_cycle_id
  from atlas.task_crop_cycles link
  where link.task_id=p_task_id
  on conflict (operation_actual_id,crop_cycle_id) do nothing;

  v_transition := case when v_result='condition_differs' then 'blocked' else v_result end;

  v_transition_result := atlas.record_task_transition_v1_internal(
    p_task_id,
    v_transition,
    v_transition_key,
    null,
    nullif(btrim(coalesce(p_note,'')),''),
    v_reason,
    'reality_expression',
    coalesce(nullif(v_task.action_key,''),nullif(v_task.operation_class,''),'operation'),
    jsonb_build_object(
      'completion_source','reality_expression_phase6',
      'structured_result_class',v_result,
      'production_operation_actual_id',v_actual.id,
      'actual_minutes',p_actual_minutes,
      'quantity',p_quantity,
      'unit',nullif(btrim(coalesce(p_unit,'')),''),
      'raw_result',v_raw,
      'before_reality',v_before
    ),
    null
  );

  v_after := atlas.task_reality_subject_snapshot_v1(p_task_id);
  v_reclassified := (v_after is distinct from v_before);

  if v_result='done' and not v_reclassified then
    raise exception 'Done rejected: the structured result did not reclassify the underlying Reality Expression subjects.' using errcode='P0001';
  end if;

  begin
    v_outcome_event_id := nullif(v_transition_result->>'taskOutcomeEventId','')::uuid;
  exception when invalid_text_representation then
    v_outcome_event_id := null;
  end;

  if v_outcome_event_id is not null then
    select we.id into v_workflow_event_id
    from atlas.workflow_events we
    where we.payload->>'task_outcome_event_id'=v_outcome_event_id::text
    order by we.created_at desc limit 1;
  end if;
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
    'taskTransition',v_transition,
    'operationActualId',v_actual.id,
    'cropCycleSubjectCount',v_crop_count,
    'productionLotSubjectCount',v_lot_count,
    'taskOutcomeEventId',v_outcome_event_id,
    'workflowEventId',v_workflow_event_id,
    'journalEventId',v_journal_event_id,
    'beforeReality',v_before,
    'afterReality',v_after,
    'reclassified',v_reclassified,
    'reconciliationState',case
      when v_result='done' then 'reclassified_and_closed'
      when v_result='partial' and v_reclassified then 'partial_reclassification_recorded'
      when v_result='partial' then 'partial_evidence_recorded_pending_reclassification'
      else 'witness_recorded_reassessment_required'
    end,
    'nextState',jsonb_build_object(
      'taskStatus',(select status from atlas.tasks where id=p_task_id),
      'reality',v_after
    )
  );
end;
$function$;

revoke all on function atlas.worker_record_state_transition_result_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text,text,text,jsonb) from public;
revoke all on function atlas.worker_record_state_transition_result_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text,text,text,jsonb) from anon;
grant execute on function atlas.worker_record_state_transition_result_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text,text,text,jsonb) to authenticated;
grant execute on function atlas.worker_record_state_transition_result_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text,text,text,jsonb) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values
(
  'atlas.worker_state_transition_card_v2(uuid, uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Expose Phase 5 execution warrant together with the Phase 6 structured result contract.','boundary','Read-only; self worker or management preview through the underlying Phase 5 authorization boundary.'),now()
),
(
  'atlas.worker_day_state_transition_cards_v2(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Read one Worker Day through Reality Expression with structured result choices.','boundary','Read-only; does not mutate task or reality state.'),now()
),
(
  'atlas.worker_record_state_transition_result_v1(uuid, uuid, uuid, date, text, integer, text, numeric, text, text, text, jsonb)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Return structured worker fruit/evidence into Production reality before task closure.','boundary','Only the signed-in routed membership may mutate. The Phase 5 card must independently authorize the operation. Done rolls back unless Reality Expression reclassifies in the same transaction.','ordering','authorize -> snapshot -> operation actual -> subject links -> canonical task outcome/workflow/journal -> re-snapshot -> done invariant -> return next state'),now()
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
