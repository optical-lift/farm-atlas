do $$
declare
  v_oid oid;
  v_definition text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='configure_project_review_core_v1'
    and pg_get_function_identity_arguments(p.oid)='p_project_id uuid, p_effective_membership_id uuid, p_effective_role text, p_cadence_days integer, p_warning_days integer, p_grace_days integer, p_first_review_date date, p_reason text, p_operator_mode boolean';
  if v_oid is null then raise exception 'configure_project_review_core_v1 was not found.'; end if;
  v_definition:=pg_get_functiondef(v_oid);
  if position('lease_started_at=now()' in v_definition)=0 then raise exception 'Expected project review activation lease assignment was not found.'; end if;
  v_definition:=replace(v_definition,'lease_started_at=now()','lease_started_at=null');
  execute v_definition;
end;
$$;
