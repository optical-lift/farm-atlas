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

  if strpos(v_sql,'and b.expected_active_minutes>0')=0
     or strpos(v_sql,'when x.expected_active_minutes<=0 then ''held''')=0
     or strpos(v_sql,'when x.expected_active_minutes<=0 then ''work_estimate_required''')=0 then
    raise exception 'Expected presentation-estimate guards were not found';
  end if;

  v_sql:=replace(
    v_sql,
    'and b.expected_active_minutes>0',
    'and (b.expected_active_minutes>0 or (b.task_type=''germination_check'' and b.operation_class=''inspect_assess''))'
  );

  v_sql:=replace(
    v_sql,
    'when x.expected_active_minutes<=0 then ''held''',
    'when x.expected_active_minutes<=0 and not (x.task_type=''germination_check'' and x.operation_class=''inspect_assess'') then ''held'''
  );

  v_sql:=replace(
    v_sql,
    'when x.expected_active_minutes<=0 then ''work_estimate_required''',
    'when x.expected_active_minutes<=0 and not (x.task_type=''germination_check'' and x.operation_class=''inspect_assess'') then ''work_estimate_required'''
  );

  execute v_sql;
end;
$migration$;

comment on function atlas.presented_work_selection_rows_legacy_v1(uuid,uuid,date) is
'Due germination inspect/assess observations may remain visible without an invented duration; arbitrary unestimated work still requires a work estimate before presentation.';
