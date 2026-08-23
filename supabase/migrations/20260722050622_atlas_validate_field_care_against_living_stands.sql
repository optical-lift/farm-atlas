do $$
declare v_definition text;
begin
  select pg_get_functiondef('atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text)'::regprocedure) into v_definition;
  v_definition:=replace(
    v_definition,
    '(select count(*) from pg_temp.production_care_input)<>(select count(distinct object_id) from atlas.task_objects where task_id=p_task_id)',
    '(select count(*) from pg_temp.production_care_input)<>(select count(*) from atlas.production_field_stands where production_lot_id=v_lot.id and current_plants>0 and stand_status not in (''failed'',''cleared''))'
  );
  v_definition:=replace(
    v_definition,
    'left join atlas.task_objects t on t.task_id=p_task_id and t.object_id=i.object_id left join atlas.production_field_care_state',
    'left join atlas.production_field_care_state'
  );
  v_definition:=replace(
    v_definition,
    'where t.object_id is null or s.id is null or fs.id is null',
    'where s.id is null or fs.id is null or fs.current_plants<=0 or fs.stand_status in (''failed'',''cleared'')'
  );
  execute v_definition;
end$$;