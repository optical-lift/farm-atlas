begin;

do $replace$
declare
  v_definition text;
  v_old text := 'least(coalesce(due_date, p_due_date), p_due_date)';
begin
  select pg_get_functiondef(
    'atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text)'::regprocedure
  ) into v_definition;

  if v_definition is null or strpos(v_definition, v_old) = 0 then
    raise exception 'The maintenance directive authoring function no longer contains the reviewed due-date expression.';
  end if;

  v_definition := replace(v_definition, v_old, 'p_due_date');
  execute v_definition;
end;
$replace$;

do $postcondition$
declare
  v_definition text;
begin
  select pg_get_functiondef(
    'atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text)'::regprocedure
  ) into v_definition;

  if strpos(v_definition, 'least(coalesce(due_date, p_due_date), p_due_date)') > 0
     or strpos(v_definition, 'set due_date = p_due_date') = 0 then
    raise exception 'Maintenance directive farm-day postcondition failed.';
  end if;
end;
$postcondition$;

comment on function atlas.create_object_maintenance_directive_v1(uuid,text,text,text,text,text,uuid,date,text,text,text,uuid[],text[],text) is
  'Object-first authoring endpoint. The selected farm day is authoritative for the temporary serving while original_task_due_date preserves the prior serving date.';

commit;
