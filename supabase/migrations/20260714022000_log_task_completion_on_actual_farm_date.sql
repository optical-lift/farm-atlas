do $$
declare
  v_signature regprocedure := 'atlas.record_task_transition_v1(uuid,text,text,date,text,text,text,text,jsonb,uuid)'::regprocedure;
  v_definition text;
  v_updated text;
begin
  select pg_get_functiondef(v_signature) into v_definition;

  v_updated := replace(
    v_definition,
    'v_today date := current_date;',
    'v_today date := (now() at time zone ''America/Chicago'')::date;'
  );

  if v_updated = v_definition then
    raise exception 'Could not update farm-local completion date in record_task_transition_v1';
  end if;

  v_definition := v_updated;
  v_updated := replace(
    v_definition,
    'v_note, v_task.title, v_task.task_type, v_task.zone_id, v_task.due_date,
      v_task.priority, ''atlas_task_engine'',',
    'v_note, v_task.title, v_task.task_type, v_task.zone_id,
      case when p_transition in (''done'', ''checklist_done'') then v_today else v_task.due_date end,
      v_task.priority, ''atlas_task_engine'','
  );

  if v_updated = v_definition then
    raise exception 'Could not update task outcome completion date in record_task_transition_v1';
  end if;

  execute v_updated;
end;
$$;
