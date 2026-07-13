-- Keep parent tasks and their actionable checklist children in sync in both directions.
-- The existing child-to-parent trigger completes a parent after its last child is done.
-- This trigger completes any remaining children when the parent itself is marked done.

create or replace function atlas.complete_child_checklist_when_parent_done()
returns trigger
language plpgsql
security definer
set search_path = atlas, public
as $function$
declare
  v_now timestamptz := now();
  child_row record;
begin
  if new.status <> 'done'
     or old.status is not distinct from new.status
     or nullif(new.metadata ->> 'parent_task_id', '') is not null
     or lower(coalesce(new.metadata ->> 'is_child_task', 'false')) in ('true', '1', 'yes') then
    return new;
  end if;

  for child_row in
    update atlas.tasks child
    set
      status = 'done',
      completed_at = coalesce(child.completed_at, v_now),
      updated_at = v_now,
      metadata = coalesce(child.metadata, '{}'::jsonb) || jsonb_build_object(
        'checklist_status', 'done',
        'checklist_completed_at', v_now,
        'completed_via_parent_done', true,
        'completed_with_parent_task_id', new.id::text,
        'last_outcome', jsonb_build_object(
          'outcome', 'done',
          'note', 'Completed with parent task.',
          'recorded_at', v_now,
          'source', 'parent_done'
        )
      )
    where child.metadata ->> 'parent_task_id' = new.id::text
      and child.status <> 'archived'
      and coalesce(child.metadata ->> 'checklist_status', '') <> 'archived'
      and (
        child.status <> 'done'
        or coalesce(child.metadata ->> 'checklist_status', '') <> 'done'
      )
    returning
      child.id,
      child.farm_id,
      child.title,
      child.task_type,
      child.zone_id,
      child.due_date,
      child.priority
  loop
    insert into atlas.task_outcome_events (
      farm_id,
      task_id,
      outcome,
      lane_key,
      work_key,
      note,
      task_title,
      task_type,
      zone_id,
      due_date,
      priority,
      source,
      metadata
    ) values (
      child_row.farm_id,
      child_row.id,
      'done',
      'checklist',
      'checked',
      'Completed with parent task.',
      child_row.title,
      child_row.task_type,
      child_row.zone_id,
      child_row.due_date,
      child_row.priority,
      'atlas_parent_completion',
      jsonb_build_object(
        'checklist_status', 'done',
        'parent_task_id', new.id::text,
        'completion_path', 'parent_done'
      )
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists trg_complete_child_checklist_when_parent_done on atlas.tasks;

create trigger trg_complete_child_checklist_when_parent_done
after update of status on atlas.tasks
for each row
when (new.status = 'done' and old.status is distinct from new.status)
execute function atlas.complete_child_checklist_when_parent_done();

comment on function atlas.complete_child_checklist_when_parent_done() is
  'When a parent task is marked done, completes every remaining non-archived checklist child and records a child outcome event. Complements auto_complete_parent_when_checklist_done().';