create or replace function atlas.record_direct_sow_seed_result_for_member_v1(
  p_farm_id uuid,p_membership_id uuid,p_task_id uuid,p_service_date date,p_result text,p_actual_minutes integer,
  p_idempotency_key text,p_remaining_quantity numeric default null,p_note text default null
) returns jsonb
language plpgsql volatile security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_membership atlas.farm_memberships%rowtype;
  v_task atlas.tasks%rowtype;
  v_card jsonb;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_actual_key text;
  v_existing atlas.production_operation_actuals%rowtype;
  v_actual atlas.production_operation_actuals%rowtype;
  v_expected_minutes integer;
  v_effect jsonb;
  v_result text:=lower(btrim(coalesce(p_result,'')));
begin
  if auth.uid() is null then raise exception 'Authenticated user required.' using errcode='42501'; end if;
  if p_service_date is null or p_actual_minutes is null or p_actual_minutes<=0 or p_actual_minutes>1440 then
    raise exception 'Service date and actual minutes from 1 to 1440 are required.' using errcode='22023';
  end if;
  if v_key is null or length(v_key)>160 then raise exception 'A valid idempotency key is required.' using errcode='22023'; end if;

  select * into v_membership from atlas.farm_memberships where id=p_membership_id and farm_id=p_farm_id and active;
  if v_membership.id is null or v_membership.user_id is distinct from auth.uid() then raise exception 'Only the routed signed-in farm member may return this result.' using errcode='42501'; end if;
  select * into v_task from atlas.tasks where id=p_task_id and farm_id=p_farm_id for update;
  if v_task.id is null then raise exception 'Task was not found on this farm.' using errcode='P0002'; end if;
  if v_membership.role not in ('owner','manager') and v_task.assigned_membership_id is distinct from v_membership.id then
    raise exception 'This task is outside the active player context.' using errcode='42501';
  end if;

  v_card:=atlas.worker_state_transition_card_v2(p_farm_id,p_membership_id,p_task_id,p_service_date);
  if coalesce(v_card #>> '{transition,state}','')<>'authorized_for_routed_day' then
    raise exception 'Reality Expression does not authorize this operation result: %',coalesce(v_card #>> '{transition,state}','unknown') using errcode='22023';
  end if;
  if coalesce(v_card #>> '{resultReturn,domainAdapter}','')<>'direct_sow_seed_v1' then
    raise exception 'This authorized operation does not use the direct-sow seed result adapter.' using errcode='22023';
  end if;
  if v_result not in ('depleted','exact_remaining','some_left_unknown') then raise exception 'Choose depleted, exact_remaining, or some_left_unknown.' using errcode='22023'; end if;

  v_actual_key:=left('re-v1:direct-sow:'||p_task_id::text||':'||md5(v_key),160);
  select * into v_existing from atlas.production_operation_actuals where farm_id=p_farm_id and idempotency_key=v_actual_key;
  if v_existing.id is not null then
    if coalesce(v_existing.metadata->>'domainAdapter','')<>'direct_sow_seed_v1' then raise exception 'Idempotency key collision with another operation result.' using errcode='23505'; end if;
    return jsonb_build_object('contractVersion','record_direct_sow_seed_result_for_member_v1','deduplicated',true,'operationActualId',v_existing.id,'taskId',p_task_id,'result',v_existing.result_payload->>'domainResult');
  end if;

  select expected_active_minutes into v_expected_minutes from atlas.task_capacity_profiles where task_id=p_task_id;
  insert into atlas.production_operation_actuals(
    farm_id,production_lot_id,task_id,operation_class,observed_date,actual_minutes,expected_minutes_before,
    quantity,unit,actor_membership_id,note,idempotency_key,metadata,result_class,result_payload
  ) values(
    p_farm_id,null,p_task_id,coalesce(nullif(v_task.operation_class,''),nullif(v_task.action_key,''),'unclassified'),
    p_service_date,p_actual_minutes,v_expected_minutes,p_remaining_quantity,
    case when p_remaining_quantity is not null then 'seeds_remaining' else null end,p_membership_id,
    nullif(btrim(coalesce(p_note,'')),''),v_actual_key,
    jsonb_build_object('contractVersion','record_direct_sow_seed_result_for_member_v1','domainAdapter','direct_sow_seed_v1','actionKey',v_task.action_key),
    'done',jsonb_strip_nulls(jsonb_build_object('domainResult',v_result,'actualMinutes',p_actual_minutes,'remainingQuantity',p_remaining_quantity,'note',nullif(btrim(coalesce(p_note,'')),''),'serviceDate',p_service_date))
  ) returning * into v_actual;

  v_effect:=atlas.record_direct_sow_seed_effect_v1(p_task_id,p_membership_id,v_result,p_remaining_quantity,p_note,v_key);
  return jsonb_build_object(
    'contractVersion','record_direct_sow_seed_result_for_member_v1','deduplicated',false,'result',v_result,'resultClass','done',
    'operationActualId',v_actual.id,'taskId',p_task_id,'domainResult',v_effect,
    'reconciliationState','seed_state_reclassified_and_sow_closed','nextState',jsonb_build_object(
      'taskStatus',(select status from atlas.tasks where id=p_task_id),'seedReadiness',atlas.task_seed_readiness_v1(p_task_id)
    )
  );
end;
$$;
revoke all on function atlas.record_direct_sow_seed_result_for_member_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text) from public,anon;
grant execute on function atlas.record_direct_sow_seed_result_for_member_v1(uuid,uuid,uuid,date,text,integer,text,numeric,text) to authenticated,service_role;
insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,security_definer_expected,
  service_execute_expected,caller_count,policy_reference_count,evidence,registered_at,reviewed_at
) values(
  'atlas.record_direct_sow_seed_result_for_member_v1(uuid, uuid, uuid, date, text, integer, text, numeric, text)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object('purpose','Record the structured post-operation seed witness for a governed direct-sow task.','boundary','Task completion, crop establishment, and seed inventory remain differentiated effects. Unknown remaining quantity cannot become an exact count; generic Done is rejected until the seed event exists.'),now(),now()
) on conflict(signature) do update set
  classification=excluded.classification,confidence=excluded.confidence,review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,evidence=excluded.evidence,reviewed_at=now();