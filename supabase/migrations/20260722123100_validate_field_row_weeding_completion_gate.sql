-- Transactional validation for the completion gate. Synthetic tasks are
-- deleted before the migration finishes, leaving only the assertion history.

do $validation$
declare
  v_farm_id uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f'::uuid;
  v_queue_key text := '__field_row_queue_validation__';
  v_first uuid;
  v_second uuid;
  v_waiting uuid;
  v_expected_due date := (now() at time zone 'America/Chicago')::date + 1;
begin
  if extract(dow from v_expected_due) = 0 then
    v_expected_due := v_expected_due + 1;
  end if;

  insert into atlas.tasks (
    farm_id, title, task_type, status, priority, due_date,
    visibility_scope, metadata
  ) values (
    v_farm_id, '__Queue validation first__', 'system_validation', 'open', 'low',
    (now() at time zone 'America/Chicago')::date,
    'system_internal', jsonb_build_object('validation_only', true)
  ) returning id into v_first;

  insert into atlas.tasks (
    farm_id, title, task_type, status, priority, due_date,
    visibility_scope, metadata
  ) values (
    v_farm_id, '__Queue validation second__', 'system_validation', 'open', 'low',
    (now() at time zone 'America/Chicago')::date,
    'system_internal', jsonb_build_object('validation_only', true)
  ) returning id into v_second;

  insert into atlas.tasks (
    farm_id, title, task_type, status, priority, due_date,
    visibility_scope, metadata
  ) values (
    v_farm_id, '__Queue validation waiting__', 'system_validation', 'archived', 'low',
    null,
    'system_internal', jsonb_build_object('validation_only', true)
  ) returning id into v_waiting;

  insert into atlas.task_release_queue_items (
    farm_id, queue_key, task_id, position, state, initial_batch, original_due_date, activated_at
  ) values
    (v_farm_id, v_queue_key, v_first, 1, 'active', true, current_date, now()),
    (v_farm_id, v_queue_key, v_second, 2, 'active', true, current_date, now()),
    (v_farm_id, v_queue_key, v_waiting, 3, 'queued', false, current_date + 1, null);

  update atlas.tasks
  set status='done', completed_at=now(), completed_by='queue_validation'
  where id=v_first;

  if (select state from atlas.task_release_queue_items where task_id=v_waiting) <> 'queued'
     or (select status from atlas.tasks where id=v_waiting) <> 'archived'
  then
    raise exception 'Queue released waiting work before the initial batch completed.';
  end if;

  update atlas.tasks
  set status='done', completed_at=now(), completed_by='queue_validation'
  where id=v_second;

  if (select state from atlas.task_release_queue_items where task_id=v_waiting) <> 'active'
     or (select status from atlas.tasks where id=v_waiting) <> 'open'
     or (select due_date from atlas.tasks where id=v_waiting) <> v_expected_due
  then
    raise exception 'Queue did not release exactly one next task for the next workday.';
  end if;

  delete from atlas.tasks where id in (v_first, v_second, v_waiting);
end;
$validation$;
