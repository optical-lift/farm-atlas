create or replace function atlas.close_child_tasks_with_parent_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_child record;
  v_transition text;
  v_parent_transition text;
  v_parent_key text;
begin
  if old.status not in ('open', 'blocked')
    or new.status not in ('done', 'archived', 'skipped')
  then
    return new;
  end if;

  v_parent_transition := lower(coalesce(new.metadata #>> '{last_transition,transition}', ''));
  v_parent_key := coalesce(
    nullif(new.metadata #>> '{last_transition,idempotency_key}', ''),
    new.id::text || ':' || new.updated_at::text
  );

  if new.status = 'done' then
    v_transition := 'checklist_done';
  elsif v_parent_transition = 'not_relevant' then
    v_transition := 'not_relevant';
  else
    v_transition := 'changed_plan';
  end if;

  for v_child in
    select child.id
    from atlas.tasks child
    where (
      child.parent_task_id = new.id
      or child.metadata ->> 'parent_task_id' = new.id::text
    )
      and child.status in ('open', 'blocked')
      and coalesce(child.metadata ->> 'checklist_status', 'open') <> 'done'
    for update
  loop
    perform atlas.record_task_transition_v1_internal(
      v_child.id,
      v_transition,
      left('parent-close:' || v_parent_key || ':' || v_child.id::text, 160),
      null,
      case when new.status = 'done' then null else 'Parent task closed.' end,
      case when new.status = 'done' then null else 'Parent task closed.' end,
      'checklist',
      'parent_close',
      jsonb_build_object(
        'parent_task_id', new.id,
        'parent_status', new.status,
        'parent_transition', nullif(v_parent_transition, ''),
        'completion_source', 'parent_attestation'
      ),
      null
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists tasks_close_children_with_parent_v1 on atlas.tasks;
create trigger tasks_close_children_with_parent_v1
after update of status on atlas.tasks
for each row
when (
  old.status in ('open', 'blocked')
  and new.status in ('done', 'archived', 'skipped')
)
execute function atlas.close_child_tasks_with_parent_v1();

do $cleanup$
declare
  v_child record;
begin
  for v_child in
    select child.id, parent.id as parent_id, parent.status as parent_status
    from atlas.tasks child
    join atlas.tasks parent
      on parent.id = coalesce(
        child.parent_task_id,
        nullif(child.metadata ->> 'parent_task_id', '')::uuid
      )
    where child.status in ('open', 'blocked')
      and parent.status in ('done', 'archived', 'skipped')
  loop
    perform atlas.record_task_transition_v1_internal(
      v_child.id,
      'changed_plan',
      left('orphan-cleanup:' || v_child.parent_id::text || ':' || v_child.id::text, 160),
      null,
      'Closed because the parent task is already closed.',
      'Closed because the parent task is already closed.',
      'checklist',
      'orphan_cleanup',
      jsonb_build_object(
        'parent_task_id', v_child.parent_id,
        'parent_status', v_child.parent_status,
        'cleanup', '2026-07-21'
      ),
      null
    );
  end loop;
end;
$cleanup$;

revoke all on function atlas.close_child_tasks_with_parent_v1() from public, anon, authenticated;
grant execute on function atlas.close_child_tasks_with_parent_v1() to service_role;
