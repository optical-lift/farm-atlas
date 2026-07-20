alter table atlas.tasks
  add column if not exists visibility_scope text,
  add column if not exists assigned_membership_id uuid;

update atlas.tasks
set visibility_scope = case
  when metadata->>'owner_task' = 'true'
    or lower(coalesce(metadata->>'assigned_to','')) = 'owner'
    or lower(coalesce(metadata->>'work_route','')) = 'owner'
  then 'owner'
  when metadata->>'anna_task' = 'true'
    or lower(coalesce(metadata->>'assigned_to','')) = 'anna'
    or lower(coalesce(metadata->>'work_route','')) = 'anna'
  then 'assigned_worker'
  when metadata->>'marshall_task' = 'true'
    or lower(coalesce(metadata->>'assigned_to','')) = 'marshall'
    or lower(coalesce(metadata->>'work_route','')) = 'marshall'
  then 'management'
  else 'management'
end
where visibility_scope is null;

alter table atlas.tasks
  alter column visibility_scope set default 'system_internal',
  alter column visibility_scope set not null;

alter table atlas.tasks
  drop constraint if exists tasks_visibility_scope_check;

alter table atlas.tasks
  add constraint tasks_visibility_scope_check
  check (visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared', 'system_internal'));

alter table atlas.tasks
  drop constraint if exists tasks_assigned_membership_id_fkey;

alter table atlas.tasks
  add constraint tasks_assigned_membership_id_fkey
  foreign key (assigned_membership_id)
  references atlas.farm_memberships(id)
  on delete set null;

create or replace function atlas.validate_task_assignment_membership_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_membership_farm_id uuid;
  v_membership_active boolean;
begin
  if new.assigned_membership_id is null then
    return new;
  end if;

  select fm.farm_id, fm.active
  into v_membership_farm_id, v_membership_active
  from atlas.farm_memberships fm
  where fm.id = new.assigned_membership_id;

  if v_membership_farm_id is null then
    raise exception 'Assigned membership does not exist.' using errcode = '23503';
  end if;

  if v_membership_farm_id <> new.farm_id then
    raise exception 'Task and assigned membership must belong to the same farm.' using errcode = '23514';
  end if;

  if not coalesce(v_membership_active, false) then
    raise exception 'Task cannot be assigned to an inactive membership.' using errcode = '23514';
  end if;

  return new;
end;
$function$;

revoke all on function atlas.validate_task_assignment_membership_v1() from public, anon, authenticated;

drop trigger if exists tasks_validate_assigned_membership on atlas.tasks;
create trigger tasks_validate_assigned_membership
before insert or update of assigned_membership_id, farm_id
on atlas.tasks
for each row
execute function atlas.validate_task_assignment_membership_v1();

create index if not exists tasks_farm_visibility_assignment_due_idx
on atlas.tasks (farm_id, visibility_scope, assigned_membership_id, status, due_date);

create or replace function atlas.current_membership_id(p_farm_id uuid)
returns uuid
language sql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
  select fm.id
  from atlas.farm_memberships fm
  where fm.user_id = auth.uid()
    and fm.farm_id = p_farm_id
    and fm.active = true
  order by fm.created_at
  limit 1
$function$;

revoke all on function atlas.current_membership_id(uuid) from public, anon;
grant execute on function atlas.current_membership_id(uuid) to authenticated;

create or replace function atlas.is_farm_manager_or_owner(p_farm_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
  select exists (
    select 1
    from atlas.farm_memberships fm
    where fm.user_id = auth.uid()
      and fm.farm_id = p_farm_id
      and fm.active = true
      and fm.role in ('owner', 'manager')
  )
$function$;

revoke all on function atlas.is_farm_manager_or_owner(uuid) from public, anon;
grant execute on function atlas.is_farm_manager_or_owner(uuid) to authenticated;

drop policy if exists tasks_read_manager on atlas.tasks;
create policy tasks_read_manager
on atlas.tasks
for select
to authenticated
using (
  atlas.current_farm_role(farm_id) = 'manager'
  and visibility_scope in ('management', 'assigned_worker', 'farm_shared')
);
