create or replace function atlas.worker_task_execution_readiness_api_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_membership atlas.farm_memberships%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authenticated user required.' using errcode='42501';
  end if;

  select * into v_task
  from atlas.tasks task
  where task.id=p_task_id;

  if v_task.id is null then
    raise exception 'Task was not found.' using errcode='P0002';
  end if;

  select * into v_membership
  from atlas.farm_memberships membership
  where membership.farm_id=v_task.farm_id
    and membership.user_id=auth.uid()
    and membership.active=true
  order by case when membership.role in ('owner','manager') then 0 else 1 end, membership.created_at
  limit 1;

  if v_membership.id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if v_membership.role not in ('owner','manager')
     and v_task.assigned_membership_id is distinct from v_membership.id
     and coalesce(v_task.metadata->>'executor_membership_id','') <> v_membership.id::text
  then
    raise exception 'Only the assigned worker or farm management may read this task readiness.' using errcode='42501';
  end if;

  return atlas.task_execution_readiness_v1(p_task_id);
end;
$$;

revoke all on function atlas.worker_task_execution_readiness_api_v1(uuid) from public, anon;
grant execute on function atlas.worker_task_execution_readiness_api_v1(uuid) to authenticated, service_role;
