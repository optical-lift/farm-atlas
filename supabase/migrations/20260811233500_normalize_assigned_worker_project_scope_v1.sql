-- `task_scope='project'` is for project-only tracking/management records. Real
-- execution assigned directly to a Farm Hand must enter the farm-operation work
-- pipeline; project membership is preserved separately through project_task_links.
-- Without this normalization an assigned worker project step can be ready and
-- open yet invisible to both the Day feed and the floating-work reservoir.

create or replace function atlas.normalize_assigned_worker_project_scope_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  if new.task_scope='project'
     and new.visibility_scope='assigned_worker'
     and new.assigned_membership_id is not null then
    new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
      'original_task_scope','project',
      'worker_execution_scope_normalized_at',now(),
      'worker_execution_scope_reason','Assigned Farm Hand execution belongs in the farm-operation work pipeline; project membership remains in project_task_links.'
    );
    new.task_scope:='farm_operation';
  end if;
  return new;
end;
$function$;

revoke all on function atlas.normalize_assigned_worker_project_scope_v1() from public,anon,authenticated;
grant execute on function atlas.normalize_assigned_worker_project_scope_v1() to service_role;

drop trigger if exists normalize_assigned_worker_project_scope_v1 on atlas.tasks;
create trigger normalize_assigned_worker_project_scope_v1
before insert or update of task_scope,visibility_scope,assigned_membership_id,metadata
on atlas.tasks
for each row execute function atlas.normalize_assigned_worker_project_scope_v1();

-- Reconcile existing active worker execution. Do not rewrite management,
-- project-shared, Owner, or historical terminal project records.
update atlas.tasks task
set task_scope='farm_operation',
    metadata=coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
      'original_task_scope','project',
      'worker_execution_scope_normalized_at',now(),
      'worker_execution_scope_reason','Assigned Farm Hand execution belongs in the farm-operation work pipeline; project membership remains in project_task_links.'
    ),
    updated_at=now()
where task.status in ('open','blocked')
  and task.task_scope='project'
  and task.visibility_scope='assigned_worker'
  and task.assigned_membership_id is not null;
