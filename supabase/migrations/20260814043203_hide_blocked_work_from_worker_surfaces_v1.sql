do $$
declare
  v_def text;
  v_patched text;
begin
  select pg_get_functiondef('atlas.owner_worker_day_plan_choreographed_v1(uuid,uuid,date)'::regprocedure) into v_def;
  v_patched := replace(v_def, 'and task.status in (''open'',''blocked'')', 'and task.status = ''open''');
  if v_patched = v_def then
    raise exception 'owner_worker_day_plan_choreographed_v1 blocked predicate was not found';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.worker_day_placed_task_cards_v1(uuid,uuid,date)'::regprocedure) into v_def;
  v_patched := replace(v_def, 'and task.status<>''archived''', 'and task.status=''open''');
  if v_patched = v_def then
    raise exception 'worker_day_placed_task_cards_v1 status predicate was not found';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.presented_work_rows_unfiltered_v1(uuid,uuid,date)'::regprocedure) into v_def;
  v_patched := replace(
    v_def,
    'and t.status in (''open'', ''blocked'')',
    'and (t.status = ''open'' or (v_target_role <> ''farm_hand'' and t.status = ''blocked''))'
  );
  if v_patched = v_def then
    raise exception 'presented_work_rows_unfiltered_v1 status predicate was not found';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.task_cards_v1(uuid,uuid)'::regprocedure) into v_def;
  v_patched := replace(
    v_def,
    E'    and task.status <> ''archived''\n    and (p_task_id is null or task.id = p_task_id)',
    E'    and task.status <> ''archived''\n    and (v_role <> ''farm_hand'' or p_task_id is not null or task.status <> ''blocked'')\n    and (p_task_id is null or task.id = p_task_id)'
  );
  if v_patched = v_def then
    raise exception 'task_cards_v1 worker blocked filter insertion point was not found';
  end if;
  execute v_patched;

  select pg_get_functiondef('atlas.owner_operator_task_cards_v1(uuid,uuid)'::regprocedure) into v_def;
  v_patched := replace(
    v_def,
    E'    and task.status <> ''archived''\n    and (p_task_id is null or task.id = p_task_id)',
    E'    and task.status <> ''archived''\n    and (v_role <> ''farm_hand'' or p_task_id is not null or task.status <> ''blocked'')\n    and (p_task_id is null or task.id = p_task_id)'
  );
  if v_patched = v_def then
    raise exception 'owner_operator_task_cards_v1 worker blocked filter insertion point was not found';
  end if;
  execute v_patched;
end;
$$;
