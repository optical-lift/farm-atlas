create or replace function atlas.record_direct_sow_seed_result_for_member_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_task_id uuid,
  p_service_date date,
  p_result text,
  p_idempotency_key text,
  p_remaining_quantity numeric default null,
  p_note text default null
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
  v_key text := nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_result text := lower(btrim(coalesce(p_result,'')));
  v_effect jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;
  if p_service_date is null then
    raise exception 'Service date is required.' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>160 then
    raise exception 'A valid idempotency key is required.' using errcode='22023';
  end if;

  select * into v_membership
  from atlas.farm_memberships
  where id=p_membership_id and farm_id=p_farm_id and active;
  if v_membership.id is null or v_membership.user_id is distinct from auth.uid() then
    raise exception 'Only the routed signed-in farm member may return this result.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks
  where id=p_task_id and farm_id=p_farm_id
  for update;
  if v_task.id is null then
    raise exception 'Task was not found on this farm.' using errcode='P0002';
  end if;
  if v_membership.role not in ('owner','manager') and v_task.assigned_membership_id is distinct from v_membership.id then
    raise exception 'This task is outside the active player context.' using errcode='42501';
  end if;

  v_card := atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  if coalesce(v_card #>> '{transition,state}','') <> 'authorized_for_routed_day' then
    raise exception 'Reality Expression does not authorize this operation result: %',coalesce(v_card #>> '{transition,state}','unknown') using errcode='22023';
  end if;
  if coalesce(v_card #>> '{resultReturn,domainAdapter}','') <> 'direct_sow_seed_v1' then
    raise exception 'This authorized operation does not use the direct-sow seed result adapter.' using errcode='22023';
  end if;
  if v_result not in ('depleted','exact_remaining','some_left_unknown') then
    raise exception 'Choose depleted, exact_remaining, or some_left_unknown.' using errcode='22023';
  end if;
  if v_result='exact_remaining' and (p_remaining_quantity is null or p_remaining_quantity<=0) then
    raise exception 'exact_remaining requires a positive remaining seed count; use depleted for zero.' using errcode='22023';
  end if;
  if v_result<>'exact_remaining' and p_remaining_quantity is not null then
    raise exception 'Remaining quantity is only accepted with exact_remaining.' using errcode='22023';
  end if;

  v_effect := atlas.record_direct_sow_seed_effect_v1(
    p_task_id,
    p_membership_id,
    v_result,
    p_remaining_quantity,
    p_note,
    v_key
  );

  return jsonb_build_object(
    'contractVersion','record_direct_sow_seed_result_for_member_v2',
    'taskId',p_task_id,
    'result',v_result,
    'resultClass','done',
    'timingCaptured',false,
    'operationActualId',null,
    'domainResult',v_effect,
    'deduplicated',coalesce((v_effect->>'deduplicated')::boolean,false),
    'reconciliationState','seed_state_reclassified_and_sow_closed',
    'nextState',jsonb_build_object(
      'taskStatus',(select status from atlas.tasks where id=p_task_id),
      'seedReadiness',atlas.task_seed_readiness_v1(p_task_id)
    )
  );
end;
$function$;

revoke all on function atlas.record_direct_sow_seed_result_for_member_v2(uuid,uuid,uuid,date,text,text,numeric,text) from public;
revoke all on function atlas.record_direct_sow_seed_result_for_member_v2(uuid,uuid,uuid,date,text,text,numeric,text) from anon;
grant execute on function atlas.record_direct_sow_seed_result_for_member_v2(uuid,uuid,uuid,date,text,text,numeric,text) to authenticated;
grant execute on function atlas.record_direct_sow_seed_result_for_member_v2(uuid,uuid,uuid,date,text,text,numeric,text) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at,anonymous_execute_expected
)
values(
  'atlas.record_direct_sow_seed_result_for_member_v2(uuid, uuid, uuid, date, text, text, numeric, text)',
  'app_endpoint','verified','active',
  true,true,true,
  1,0,
  jsonb_build_object(
    'purpose','Record the structured post-sow seed witness and close a governed direct-sow task without requiring the worker to time the operation.',
    'boundary','Seed remainder truth is required. Duration is not collected or fabricated. The existing internal direct-sow seed effect remains the mutation boundary for inventory and task closure.',
    'supersedesForInteractiveUse','record_direct_sow_seed_result_for_member_v1',
    'durationRequired',false
  ),
  now(),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at,
  anonymous_execute_expected=excluded.anonymous_execute_expected;
