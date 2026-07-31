do $$
declare
  v_oid oid;
  v_definition text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='record_project_review_result_core_v1'
    and pg_get_function_identity_arguments(p.oid)='p_task_id uuid, p_effective_membership_id uuid, p_effective_role text, p_outcome text, p_next_milestone text, p_next_review_date date, p_note text, p_idempotency_key text, p_operator_mode boolean';
  if v_oid is null then raise exception 'record_project_review_result_core_v1 was not found.'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  if position('active_until=v_now' in v_definition)=0 then raise exception 'Expected project review completion boundary was not found.'; end if;
  v_definition:=replace(v_definition,'active_until=v_now','active_until=greatest(v_now,v_binding.active_from+interval ''1 second'')');
  execute v_definition;
end;
$$;
