do $do$
declare
  v_oid oid;
  v_def text;
  v_old text := $old$  v_actual_key := left('state-result:'||p_task_id::text||':'||md5(v_key),120);$old$;
  v_new text := $new$  v_actual_key := left('re-v1:germ:'||p_task_id::text||':'||md5(v_key),120);$new$;
  v_old_dedupe text := $old$  if v_existing.id is not null then
    return jsonb_build_object(
      'contractVersion','worker_record_state_transition_result_v1',
      'deduplicated',true,
      'result',v_existing.result_payload->>'domainResult',
      'resultClass',v_existing.result_class,
      'operationActualId',v_existing.id,
      'taskId',p_task_id,
      'reconciliationState','previously_reconciled'
    );
  end if;$old$;
  v_new_dedupe text := $new$  if v_existing.id is not null then
    if coalesce(v_existing.metadata->>'contractVersion','')<>'worker_record_state_transition_result_v1'
       or coalesce(v_existing.metadata->>'domainAdapter','')<>'germination_observation_v2'
       or coalesce(v_existing.result_payload->>'domainResult','') not in ('not_yet','beginning','germinated','failed_or_uncertain','problem_found') then
      raise exception 'Idempotency key collision with a non-Phase-6 operation actual.' using errcode='23505';
    end if;
    return jsonb_build_object(
      'contractVersion','worker_record_state_transition_result_v1',
      'deduplicated',true,
      'result',v_existing.result_payload->>'domainResult',
      'resultClass',v_existing.result_class,
      'operationActualId',v_existing.id,
      'taskId',p_task_id,
      'reconciliationState','previously_reconciled'
    );
  end if;$new$;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='worker_record_state_transition_result_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_task_id uuid, p_service_date date, p_result text, p_actual_minutes integer, p_idempotency_key text, p_quantity numeric, p_unit text, p_note text, p_reason text, p_result_payload jsonb';
  if v_oid is null then raise exception 'Phase 6 result RPC not found.'; end if;
  v_def:=pg_get_functiondef(v_oid);
  if position(v_old in v_def)=0 then raise exception 'Expected Phase 6 idempotency key expression not found.'; end if;
  if position(v_old_dedupe in v_def)=0 then raise exception 'Expected Phase 6 dedupe block not found.'; end if;
  v_def:=replace(v_def,v_old,v_new);
  v_def:=replace(v_def,v_old_dedupe,v_new_dedupe);
  execute v_def;
end
$do$;
