do $$
declare
  v_sql text;
begin
  select pg_get_functiondef('atlas.seed_task_execution_checklist_v1(uuid)'::regprocedure) into v_sql;
  v_sql := replace(v_sql, '''Restock and reset the coffee bar''', '''Show people the hutch to select a mug''');
  v_sql := replace(v_sql, '''Set out the Keurig and real mugs''', '''Show people the hutch to select a mug''');
  v_sql := replace(v_sql, '''Refill the water dispenser''', '''Confirm the water dispenser is full.''');
  v_sql := replace(v_sql, '''Set out the water dispenser''', '''Confirm the water dispenser is full.''');
  execute v_sql;

  select pg_get_functiondef('atlas.normalize_thursday_morning_cluster_occurrence_v2()'::regprocedure) into v_sql;
  v_sql := replace(v_sql, '''Cold brew · coffee bar · water dispenser''', '''Keurig · mug hutch · water dispenser''');
  v_sql := replace(v_sql, '''Keurig · real mugs · water''', '''Keurig · mug hutch · water dispenser''');
  execute v_sql;

  select pg_get_functiondef('atlas.worker_state_transition_card_v1(uuid,uuid,uuid,date)'::regprocedure) into v_sql;
  v_sql := replace(
    v_sql,
    'when v_crop_count+v_production_count=0 then ''reality_subject_unrepresented''',
    'when v_crop_count+v_production_count=0 and not coalesce((atlas.task_execution_readiness_v1(v_task.id)->>''ready'')::boolean,false) then ''execution_readiness_required'''
  );
  v_sql := replace(
    v_sql,
    'when v_crop_count+v_production_count=0 then ''unrepresented''',
    'when v_crop_count+v_production_count=0 then case when coalesce((atlas.task_execution_readiness_v1(v_task.id)->>''ready'')::boolean,false) then ''not_applicable_execution_readiness_supported'' else ''execution_readiness_required'' end'
  );
  execute v_sql;
end $$;