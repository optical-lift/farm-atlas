do $$
declare v_definition text;
begin
  select pg_get_functiondef('atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text)'::regprocedure) into v_definition;
  if position('(select count(*) from pg_temp.production_care_input)<>(select count(*) from atlas.task_objects where task_id=p_task_id)' in v_definition)=0 then
    raise exception 'Expected field-care bed-count expression was not found';
  end if;
  v_definition:=replace(
    v_definition,
    '(select count(*) from pg_temp.production_care_input)<>(select count(*) from atlas.task_objects where task_id=p_task_id)',
    '(select count(*) from pg_temp.production_care_input)<>(select count(distinct object_id) from atlas.task_objects where task_id=p_task_id)'
  );
  execute v_definition;
end$$;