do $migration$
declare
  v_oid oid;
  v_sql text;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='presented_work_selection_rows_legacy_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_work_date date';

  if v_oid is null then
    raise exception 'presented_work_selection_rows_legacy_v1 not found';
  end if;

  v_sql:=pg_get_functiondef(v_oid);

  if strpos(v_sql,'t.status,t.due_date,t.priority,t.metadata,t.operation_class,t.planned_occurrence_id')=0 then
    raise exception 'Expected base task projection was not found';
  end if;

  v_sql:=replace(
    v_sql,
    't.status,t.due_date,t.priority,t.metadata,t.operation_class,t.planned_occurrence_id',
    't.status,t.due_date,t.priority,t.metadata,t.task_type,t.operation_class,t.planned_occurrence_id'
  );

  execute v_sql;
end;
$migration$;
