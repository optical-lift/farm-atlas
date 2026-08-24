create or replace function atlas.retire_released_leaf_task_on_occurrence_cancel_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
begin
  if new.state is distinct from 'cancelled'
     or old.state is not distinct from new.state
     or new.released_task_id is null then
    return new;
  end if;

  -- Aggregate/container tasks do not own the lifecycle of independently
  -- scheduled members. This invariant is intentionally leaf-scoped.
  if exists (
    select 1
    from atlas.tasks child
    where child.parent_task_id = new.released_task_id
       or child.metadata->>'parent_task_id' = new.released_task_id::text
  ) then
    return new;
  end if;

  update atlas.tasks t
  set status = 'archived',
      completed_at = null,
      metadata = coalesce(t.metadata, '{}'::jsonb) || jsonb_build_object(
        'source_occurrence_cancelled', true,
        'source_occurrence_cancelled_at', now(),
        'source_occurrence_id', new.id
      ),
      updated_at = now()
  where t.id = new.released_task_id
    and t.planned_occurrence_id = new.id
    and t.status in ('open','blocked');

  return new;
end;
$function$;

revoke all on function atlas.retire_released_leaf_task_on_occurrence_cancel_v1() from public, anon, authenticated;

drop trigger if exists retire_released_leaf_task_on_occurrence_cancel_v1 on atlas.planned_work_occurrences;
create trigger retire_released_leaf_task_on_occurrence_cancel_v1
after update of state on atlas.planned_work_occurrences
for each row
when (old.state is distinct from new.state and new.state = 'cancelled')
execute function atlas.retire_released_leaf_task_on_occurrence_cancel_v1();