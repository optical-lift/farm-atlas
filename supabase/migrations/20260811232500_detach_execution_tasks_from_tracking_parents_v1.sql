-- A project-tracking-only card is not an executable parent task. If a real
-- assigned-worker task is structurally nested beneath it, the worker Day reader
-- treats that execution task as a hidden child and drops it from the Day.
-- Preserve project/task history, but detach real execution from tracking-only
-- task hierarchy and keep the former tracking parent as provenance metadata.

create or replace function atlas.detach_execution_task_from_tracking_parent_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_parent atlas.tasks%rowtype;
begin
  if new.parent_task_id is null
     or new.visibility_scope<>'assigned_worker'
     or new.assigned_membership_id is null then
    return new;
  end if;

  select * into v_parent
  from atlas.tasks parent
  where parent.id=new.parent_task_id
    and parent.farm_id=new.farm_id;

  if v_parent.id is null
     or not coalesce((v_parent.metadata->>'project_tracking_only')::boolean,false) then
    return new;
  end if;

  new.metadata:=coalesce(new.metadata,'{}'::jsonb) || jsonb_build_object(
    'tracking_parent_task_id',v_parent.id,
    'tracking_parent_title',v_parent.title,
    'tracking_parent_detached_at',now(),
    'tracking_parent_detached_reason','Worker execution is represented directly; the former parent is project-state tracking only.'
  );
  new.parent_task_id:=null;
  return new;
end;
$function$;

revoke all on function atlas.detach_execution_task_from_tracking_parent_v1() from public,anon,authenticated;
grant execute on function atlas.detach_execution_task_from_tracking_parent_v1() to service_role;

drop trigger if exists detach_execution_task_from_tracking_parent_v1 on atlas.tasks;
create trigger detach_execution_task_from_tracking_parent_v1
before insert or update of parent_task_id,visibility_scope,assigned_membership_id,metadata
on atlas.tasks
for each row execute function atlas.detach_execution_task_from_tracking_parent_v1();

-- Reconcile existing active worker execution tasks. The project relationship and
-- prerequisite graph remain canonical, so detaching this hierarchy edge does not
-- remove event membership or dependency truth.
update atlas.tasks child
set metadata=coalesce(child.metadata,'{}'::jsonb) || jsonb_build_object(
      'tracking_parent_task_id',parent.id,
      'tracking_parent_title',parent.title,
      'tracking_parent_detached_at',now(),
      'tracking_parent_detached_reason','Worker execution is represented directly; the former parent is project-state tracking only.'
    ),
    parent_task_id=null,
    updated_at=now()
from atlas.tasks parent
where child.parent_task_id=parent.id
  and child.farm_id=parent.farm_id
  and child.status in ('open','blocked')
  and child.visibility_scope='assigned_worker'
  and child.assigned_membership_id is not null
  and coalesce((parent.metadata->>'project_tracking_only')::boolean,false)=true;
