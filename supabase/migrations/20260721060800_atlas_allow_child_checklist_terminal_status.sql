create or replace function atlas.normalize_child_checklist_task_status()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  new.metadata := coalesce(new.metadata, '{}'::jsonb);

  if coalesce((new.metadata ->> 'is_child_task')::boolean, false) then
    if new.status in ('archived', 'skipped') then
      new.metadata := jsonb_set(
        new.metadata,
        '{checklist_status}',
        to_jsonb(new.status),
        true
      );
    elsif new.metadata ->> 'checklist_status' = 'done' then
      new.status := 'done';
    elsif new.metadata ->> 'checklist_status' = 'open' then
      new.status := 'open';
    end if;
  end if;

  return new;
end;
$function$;

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
      left('orphan-cleanup-v2:' || v_child.parent_id::text || ':' || v_child.id::text, 160),
      null,
      'Closed because the parent task is already closed.',
      'Closed because the parent task is already closed.',
      'checklist',
      'orphan_cleanup',
      jsonb_build_object(
        'parent_task_id', v_child.parent_id,
        'parent_status', v_child.parent_status,
        'cleanup', '2026-07-21',
        'normalization_repair', true
      ),
      null
    );
  end loop;
end;
$cleanup$;
