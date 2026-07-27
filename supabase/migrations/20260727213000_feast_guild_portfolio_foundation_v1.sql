create table if not exists atlas.organizations (
  id uuid primary key default gen_random_uuid(),
  stable_key text not null unique,
  name text not null,
  status text not null default 'active' check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organizations_updated_at on atlas.organizations;
create trigger set_organizations_updated_at
before update on atlas.organizations
for each row execute function atlas.set_updated_at();

insert into atlas.organizations (stable_key, name, status, metadata)
values (
  'feast_guild',
  'Feast Guild',
  'active',
  jsonb_build_object(
    'organization_kind', 'farm_collective',
    'portal_label', 'Feast Guild',
    'created_from', 'portfolio_foundation_v1'
  )
)
on conflict (stable_key) do update
set name = excluded.name,
    status = excluded.status,
    metadata = atlas.organizations.metadata || excluded.metadata,
    updated_at = now();

alter table atlas.farms
  add column if not exists organization_id uuid references atlas.organizations(id) on delete restrict,
  add column if not exists metadata jsonb not null default '{}'::jsonb;

update atlas.farms f
set organization_id = o.id
from atlas.organizations o
where o.stable_key = 'feast_guild'
  and f.organization_id is null;

alter table atlas.farms alter column organization_id set not null;
create index if not exists farms_organization_idx on atlas.farms(organization_id, status, name);

create table if not exists atlas.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','consultant','member')),
  active boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id)
);

create index if not exists organization_memberships_user_idx
  on atlas.organization_memberships(user_id, active, organization_id);

drop trigger if exists set_organization_memberships_updated_at on atlas.organization_memberships;
create trigger set_organization_memberships_updated_at
before update on atlas.organization_memberships
for each row execute function atlas.set_updated_at();

create table if not exists atlas.places (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  parent_place_id uuid references atlas.places(id) on delete cascade,
  stable_key text not null,
  label text not null,
  place_type text not null,
  status text not null default 'active' check (status in ('active','inactive','archived')),
  facts jsonb not null default '{}'::jsonb,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key)
);

create index if not exists places_farm_parent_idx
  on atlas.places(farm_id, parent_place_id, sort_order, label);

drop trigger if exists set_places_updated_at on atlas.places;
create trigger set_places_updated_at
before update on atlas.places
for each row execute function atlas.set_updated_at();

alter table atlas.projects
  add column if not exists organization_id uuid references atlas.organizations(id) on delete restrict,
  add column if not exists workstream text not null default 'farm_operations',
  add column if not exists project_kind text not null default 'farm',
  add column if not exists outcome_text text,
  add column if not exists current_milestone text,
  add column if not exists health_status text not null default 'moving',
  add column if not exists target_date date,
  add column if not exists last_movement_at timestamptz;

update atlas.projects p
set organization_id = f.organization_id,
    outcome_text = coalesce(p.outcome_text, p.goal_text),
    last_movement_at = coalesce(p.last_movement_at, p.updated_at)
from atlas.farms f
where p.farm_id = f.id
  and (p.organization_id is null or p.outcome_text is null or p.last_movement_at is null);

alter table atlas.projects alter column organization_id set not null;
alter table atlas.projects alter column farm_id drop not null;
alter table atlas.projects drop constraint if exists projects_farm_id_stable_key_key;
alter table atlas.projects drop constraint if exists projects_project_kind_check;
alter table atlas.projects add constraint projects_project_kind_check
  check (project_kind in ('farm','cross_farm','organization'));
alter table atlas.projects drop constraint if exists projects_health_status_check;
alter table atlas.projects add constraint projects_health_status_check
  check (health_status in ('moving','waiting','blocked','at_risk','complete','quiet'));

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'atlas.projects'::regclass
      and conname = 'projects_organization_id_stable_key_key'
  ) then
    alter table atlas.projects
      add constraint projects_organization_id_stable_key_key unique (organization_id, stable_key);
  end if;
end $$;

create index if not exists projects_portfolio_idx
  on atlas.projects(organization_id, status, farm_id, workstream, sort_order);

create table if not exists atlas.project_contributors (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references atlas.projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contribution_role text not null check (contribution_role in ('lead','contributor','reviewer','decision_maker')),
  active boolean not null default true,
  can_create_tasks boolean not null default false,
  can_complete_tasks boolean not null default false,
  can_submit_results boolean not null default true,
  permissions jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id, user_id)
);

create index if not exists project_contributors_user_idx
  on atlas.project_contributors(user_id, active, project_id);

drop trigger if exists set_project_contributors_updated_at on atlas.project_contributors;
create trigger set_project_contributors_updated_at
before update on atlas.project_contributors
for each row execute function atlas.set_updated_at();

create table if not exists atlas.project_targets (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references atlas.projects(id) on delete cascade,
  farm_id uuid references atlas.farms(id) on delete cascade,
  place_id uuid references atlas.places(id) on delete cascade,
  zone_id uuid references atlas.zones(id) on delete cascade,
  target_role text not null default 'context',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(farm_id, place_id, zone_id) > 0)
);

create index if not exists project_targets_project_idx on atlas.project_targets(project_id);
create index if not exists project_targets_farm_idx on atlas.project_targets(farm_id) where farm_id is not null;
create index if not exists project_targets_place_idx on atlas.project_targets(place_id) where place_id is not null;

drop trigger if exists set_project_targets_updated_at on atlas.project_targets;
create trigger set_project_targets_updated_at
before update on atlas.project_targets
for each row execute function atlas.set_updated_at();

create table if not exists atlas.project_attention_items (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references atlas.projects(id) on delete cascade,
  attention_type text not null check (attention_type in ('decision','review','blocked','missing_information','external_dependency','deadline_risk','quiet')),
  title text not null,
  detail text,
  status text not null default 'open' check (status in ('open','resolved','dismissed')),
  assigned_user_id uuid references auth.users(id) on delete set null,
  due_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists project_attention_open_idx
  on atlas.project_attention_items(project_id, status, due_date);

drop trigger if exists set_project_attention_items_updated_at on atlas.project_attention_items;
create trigger set_project_attention_items_updated_at
before update on atlas.project_attention_items
for each row execute function atlas.set_updated_at();

alter table atlas.tasks
  add column if not exists organization_id uuid references atlas.organizations(id) on delete restrict,
  add column if not exists task_scope text not null default 'farm_operation',
  add column if not exists assigned_user_id uuid references auth.users(id) on delete set null,
  add column if not exists created_by_user_id uuid references auth.users(id) on delete set null,
  add column if not exists origin_kind text not null default 'legacy';

update atlas.tasks t
set organization_id = f.organization_id
from atlas.farms f
where t.farm_id = f.id
  and t.organization_id is null;

alter table atlas.tasks alter column organization_id set not null;
alter table atlas.tasks alter column farm_id drop not null;
alter table atlas.tasks drop constraint if exists tasks_task_scope_check;
alter table atlas.tasks add constraint tasks_task_scope_check
  check (task_scope in ('farm_operation','project'));
alter table atlas.tasks drop constraint if exists tasks_origin_kind_check;
alter table atlas.tasks add constraint tasks_origin_kind_check
  check (origin_kind in ('legacy','owner_assigned','contributor_created','generated'));
alter table atlas.tasks drop constraint if exists tasks_scope_anchor_check;
alter table atlas.tasks add constraint tasks_scope_anchor_check
  check (
    (task_scope = 'farm_operation' and farm_id is not null)
    or (task_scope = 'project' and organization_id is not null)
  );
alter table atlas.tasks drop constraint if exists tasks_visibility_scope_check;
alter table atlas.tasks add constraint tasks_visibility_scope_check
  check (visibility_scope in ('owner','management','assigned_worker','farm_shared','project_shared','system_internal'));

create index if not exists tasks_assigned_user_idx
  on atlas.tasks(assigned_user_id, status, due_date)
  where assigned_user_id is not null;
create index if not exists tasks_organization_scope_idx
  on atlas.tasks(organization_id, task_scope, status, due_date);

-- Project tasks remain canonical Atlas tasks but do not enter the farm-operation release engine.
drop trigger if exists zy_install_task_release_gate_v1 on atlas.tasks;
create trigger zy_install_task_release_gate_v1
before insert on atlas.tasks
for each row
when (new.task_scope = 'farm_operation')
execute function atlas.install_task_release_gate_v1();

drop trigger if exists zz_validate_active_task_release_v1 on atlas.tasks;
create trigger zz_validate_active_task_release_v1
before insert or update of status, due_date, planned_occurrence_id, release_policy_id, released_at on atlas.tasks
for each row
when (new.task_scope = 'farm_operation')
execute function atlas.validate_active_task_release_v1();

drop trigger if exists zz_release_after_task_terminal_v1 on atlas.tasks;
create trigger zz_release_after_task_terminal_v1
after update of status on atlas.tasks
for each row
when (
  old.task_scope = 'farm_operation'
  and new.task_scope = 'farm_operation'
  and old.status is distinct from new.status
)
execute function atlas.release_after_task_terminal_v1();

create or replace function atlas.is_organization_member(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select exists (
    select 1
    from atlas.organization_memberships om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.active = true
  );
$$;

create or replace function atlas.is_organization_owner(p_organization_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select exists (
    select 1
    from atlas.organization_memberships om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.active = true
      and om.role = 'owner'
  );
$$;

create or replace function atlas.can_read_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select exists (
    select 1
    from atlas.projects p
    where p.id = p_project_id
      and (
        atlas.is_organization_owner(p.organization_id)
        or exists (
          select 1
          from atlas.project_contributors pc
          where pc.project_id = p.id
            and pc.user_id = auth.uid()
            and pc.active = true
        )
      )
  );
$$;

create or replace function atlas.can_contribute_to_project(p_project_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select exists (
    select 1
    from atlas.projects p
    where p.id = p_project_id
      and (
        atlas.is_organization_owner(p.organization_id)
        or exists (
          select 1
          from atlas.project_contributors pc
          where pc.project_id = p.id
            and pc.user_id = auth.uid()
            and pc.active = true
            and pc.can_create_tasks = true
        )
      )
  );
$$;

grant execute on function atlas.is_organization_member(uuid) to authenticated;
grant execute on function atlas.is_organization_owner(uuid) to authenticated;
grant execute on function atlas.can_read_project(uuid) to authenticated;
grant execute on function atlas.can_contribute_to_project(uuid) to authenticated;

alter table atlas.organizations enable row level security;
alter table atlas.organization_memberships enable row level security;
alter table atlas.places enable row level security;
alter table atlas.project_contributors enable row level security;
alter table atlas.project_targets enable row level security;
alter table atlas.project_attention_items enable row level security;

drop policy if exists organizations_read_member on atlas.organizations;
create policy organizations_read_member on atlas.organizations
for select to authenticated
using (atlas.is_organization_member(id));

drop policy if exists organization_memberships_read_self on atlas.organization_memberships;
create policy organization_memberships_read_self on atlas.organization_memberships
for select to authenticated
using (user_id = auth.uid());

drop policy if exists organization_memberships_read_owner on atlas.organization_memberships;
create policy organization_memberships_read_owner on atlas.organization_memberships
for select to authenticated
using (atlas.is_organization_owner(organization_id));

drop policy if exists places_read_project_or_farm on atlas.places;
create policy places_read_project_or_farm on atlas.places
for select to authenticated
using (
  atlas.can_read_farm_operations(farm_id)
  or exists (
    select 1
    from atlas.project_targets pt
    where pt.place_id = places.id
      and atlas.can_read_project(pt.project_id)
  )
);

drop policy if exists projects_read_operations on atlas.projects;
create policy projects_read_operations on atlas.projects
for select to authenticated
using (atlas.can_read_project(id));

drop policy if exists project_steps_read_operations on atlas.project_steps;
create policy project_steps_read_operations on atlas.project_steps
for select to authenticated
using (atlas.can_read_project(project_id));

drop policy if exists project_task_links_read_operations on atlas.project_task_links;
create policy project_task_links_read_operations on atlas.project_task_links
for select to authenticated
using (atlas.can_read_project(project_id));

drop policy if exists project_contributors_read_visible on atlas.project_contributors;
create policy project_contributors_read_visible on atlas.project_contributors
for select to authenticated
using (atlas.can_read_project(project_id));

drop policy if exists project_targets_read_visible on atlas.project_targets;
create policy project_targets_read_visible on atlas.project_targets
for select to authenticated
using (atlas.can_read_project(project_id));

drop policy if exists project_attention_items_read_visible on atlas.project_attention_items;
create policy project_attention_items_read_visible on atlas.project_attention_items
for select to authenticated
using (atlas.can_read_project(project_id));

drop policy if exists tasks_read_project_contributor on atlas.tasks;
create policy tasks_read_project_contributor on atlas.tasks
for select to authenticated
using (
  assigned_user_id = auth.uid()
  or exists (
    select 1
    from atlas.project_task_links ptl
    where ptl.task_id = tasks.id
      and atlas.can_read_project(ptl.project_id)
  )
);

create or replace function atlas.portfolio_project_card_v1(p_project_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select jsonb_build_object(
    'projectId', p.id,
    'projectKey', p.stable_key,
    'title', p.title,
    'status', p.status,
    'projectKind', p.project_kind,
    'workstream', p.workstream,
    'outcome', coalesce(p.outcome_text, p.goal_text),
    'currentMilestone', p.current_milestone,
    'health', p.health_status,
    'targetDate', p.target_date,
    'lastMovementAt', p.last_movement_at,
    'farmId', f.id,
    'farmKey', f.stable_key,
    'farmName', f.name,
    'myRole', (
      select pc.contribution_role
      from atlas.project_contributors pc
      where pc.project_id = p.id
        and pc.user_id = auth.uid()
        and pc.active = true
      limit 1
    ),
    'canCreateTasks', atlas.can_contribute_to_project(p.id),
    'openTaskCount', (
      select count(*)
      from atlas.project_task_links ptl
      join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id
        and t.status in ('open','blocked')
    ),
    'blockedTaskCount', (
      select count(*)
      from atlas.project_task_links ptl
      join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id
        and t.status = 'blocked'
    ),
    'openAttentionCount', (
      select count(*)
      from atlas.project_attention_items pai
      where pai.project_id = p.id
        and pai.status = 'open'
    ),
    'targets', coalesce((
      select jsonb_agg(jsonb_build_object(
        'targetRole', pt.target_role,
        'farmId', tf.id,
        'farmName', tf.name,
        'placeId', pl.id,
        'placeLabel', pl.label,
        'placeType', pl.place_type,
        'zoneId', z.id,
        'zoneLabel', z.label
      ) order by pt.created_at)
      from atlas.project_targets pt
      left join atlas.farms tf on tf.id = pt.farm_id
      left join atlas.places pl on pl.id = pt.place_id
      left join atlas.zones z on z.id = pt.zone_id
      where pt.project_id = p.id
    ), '[]'::jsonb)
  )
  from atlas.projects p
  left join atlas.farms f on f.id = p.farm_id
  where p.id = p_project_id;
$$;

grant execute on function atlas.portfolio_project_card_v1(uuid) to authenticated;

create or replace function atlas.portfolio_home_v1(p_organization_id uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_role text;
  v_result jsonb;
begin
  select om.organization_id, om.role
  into v_organization_id, v_role
  from atlas.organization_memberships om
  where om.user_id = v_user_id
    and om.active = true
    and (p_organization_id is null or om.organization_id = p_organization_id)
  order by case when om.role = 'owner' then 0 else 1 end, om.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'An active Feast Guild membership is required.' using errcode = '42501';
  end if;

  with visible_projects as (
    select p.*
    from atlas.projects p
    where p.organization_id = v_organization_id
      and p.status <> 'archived'
      and (
        v_role = 'owner'
        or exists (
          select 1
          from atlas.project_contributors pc
          where pc.project_id = p.id
            and pc.user_id = v_user_id
            and pc.active = true
        )
      )
  )
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'organizationId', o.id,
      'organizationKey', o.stable_key,
      'name', o.name
    ),
    'viewer', jsonb_build_object(
      'role', v_role,
      'isOwner', v_role = 'owner'
    ),
    'workstreams', coalesce((
      select jsonb_agg(workstream order by workstream)
      from (select distinct vp.workstream from visible_projects vp) ws
    ), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(item order by sort_date nulls last, title)
      from (
        select
          jsonb_build_object(
            'attentionId', pai.id,
            'kind', pai.attention_type,
            'title', pai.title,
            'detail', pai.detail,
            'dueDate', pai.due_date,
            'projectId', vp.id,
            'projectTitle', vp.title,
            'farmName', f.name
          ) as item,
          pai.due_date as sort_date,
          pai.title
        from visible_projects vp
        join atlas.project_attention_items pai on pai.project_id = vp.id and pai.status = 'open'
        left join atlas.farms f on f.id = vp.farm_id

        union all

        select
          jsonb_build_object(
            'attentionId', null,
            'kind', 'blocked',
            'title', t.title,
            'detail', coalesce(t.blocker_text, 'This project task is blocked.'),
            'dueDate', t.due_date,
            'projectId', vp.id,
            'projectTitle', vp.title,
            'farmName', f.name
          ) as item,
          t.due_date as sort_date,
          t.title
        from visible_projects vp
        join atlas.project_task_links ptl on ptl.project_id = vp.id
        join atlas.tasks t on t.id = ptl.task_id and t.status = 'blocked'
        left join atlas.farms f on f.id = vp.farm_id

        union all

        select
          jsonb_build_object(
            'attentionId', null,
            'kind', 'deadline_risk',
            'title', t.title,
            'detail', 'This project task is past its due date.',
            'dueDate', t.due_date,
            'projectId', vp.id,
            'projectTitle', vp.title,
            'farmName', f.name
          ) as item,
          t.due_date as sort_date,
          t.title
        from visible_projects vp
        join atlas.project_task_links ptl on ptl.project_id = vp.id
        join atlas.tasks t on t.id = ptl.task_id
        left join atlas.farms f on f.id = vp.farm_id
        where t.status = 'open'
          and t.due_date < current_date
      ) attention_rows
    ), '[]'::jsonb),
    'crossFarmProjects', coalesce((
      select jsonb_agg(atlas.portfolio_project_card_v1(vp.id) order by vp.sort_order, vp.title)
      from visible_projects vp
      where vp.farm_id is null
    ), '[]'::jsonb),
    'farms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'farmId', f.id,
        'farmKey', f.stable_key,
        'farmName', f.name,
        'status', f.status,
        'facts', f.metadata,
        'projects', coalesce((
          select jsonb_agg(atlas.portfolio_project_card_v1(vp.id) order by vp.workstream, vp.sort_order, vp.title)
          from visible_projects vp
          where vp.farm_id = f.id
        ), '[]'::jsonb)
      ) order by f.name)
      from atlas.farms f
      where f.organization_id = v_organization_id
        and f.status = 'active'
        and (
          v_role = 'owner'
          or exists (select 1 from visible_projects vp where vp.farm_id = f.id)
        )
    ), '[]'::jsonb)
  )
  into v_result
  from atlas.organizations o
  where o.id = v_organization_id;

  return v_result;
end;
$$;

grant execute on function atlas.portfolio_home_v1(uuid) to authenticated;

create or replace function atlas.project_detail_v1(p_project_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_result jsonb;
begin
  if not atlas.can_read_project(p_project_id) then
    raise exception 'Project access is not active.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'project', atlas.portfolio_project_card_v1(p.id),
    'permissions', jsonb_build_object(
      'canCreateTasks', atlas.can_contribute_to_project(p.id),
      'isOrganizationOwner', atlas.is_organization_owner(p.organization_id)
    ),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId', t.id,
        'title', t.title,
        'status', t.status,
        'priority', t.priority,
        'dueDate', t.due_date,
        'note', t.note,
        'blockerText', t.blocker_text,
        'assignedToViewer', t.assigned_user_id = auth.uid(),
        'createdByViewer', t.created_by_user_id = auth.uid(),
        'originKind', t.origin_kind,
        'createdAt', t.created_at,
        'updatedAt', t.updated_at
      ) order by
        case when t.status in ('open','blocked') then 0 else 1 end,
        t.due_date nulls last,
        ptl.sort_order,
        t.created_at)
      from atlas.project_task_links ptl
      join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stepId', ps.id,
        'title', ps.title,
        'status', ps.status,
        'stepOrder', ps.step_order,
        'linkedTaskId', ps.linked_task_id,
        'note', ps.note
      ) order by ps.step_order, ps.created_at)
      from atlas.project_steps ps
      where ps.project_id = p.id
    ), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attentionId', pai.id,
        'kind', pai.attention_type,
        'title', pai.title,
        'detail', pai.detail,
        'dueDate', pai.due_date,
        'status', pai.status
      ) order by pai.due_date nulls last, pai.created_at)
      from atlas.project_attention_items pai
      where pai.project_id = p.id
        and pai.status = 'open'
    ), '[]'::jsonb)
  )
  into v_result
  from atlas.projects p
  where p.id = p_project_id;

  return v_result;
end;
$$;

grant execute on function atlas.project_detail_v1(uuid) to authenticated;

create or replace function atlas.create_project_task_v1(
  p_project_id uuid,
  p_title text,
  p_due_date date default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_project atlas.projects%rowtype;
  v_task_id uuid;
  v_sort_order integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;
  if nullif(btrim(p_title), '') is null then
    raise exception 'Task title is required.' using errcode = '22023';
  end if;
  if not atlas.can_contribute_to_project(p_project_id) then
    raise exception 'Project contribution access is not active.' using errcode = '42501';
  end if;

  select * into v_project from atlas.projects where id = p_project_id;
  if v_project.id is null then
    raise exception 'Project not found.' using errcode = 'P0002';
  end if;

  insert into atlas.tasks (
    organization_id,
    farm_id,
    task_scope,
    title,
    task_type,
    status,
    priority,
    due_date,
    note,
    visibility_scope,
    assigned_user_id,
    created_by_user_id,
    origin_kind,
    metadata
  ) values (
    v_project.organization_id,
    v_project.farm_id,
    'project',
    btrim(p_title),
    'project',
    'open',
    'normal',
    p_due_date,
    nullif(btrim(p_note), ''),
    'project_shared',
    auth.uid(),
    auth.uid(),
    'contributor_created',
    jsonb_build_object(
      'project_task', true,
      'project_id', v_project.id,
      'workstream', v_project.workstream,
      'created_from', 'project_contributor'
    )
  ) returning id into v_task_id;

  select coalesce(max(ptl.sort_order), 0) + 10
  into v_sort_order
  from atlas.project_task_links ptl
  where ptl.project_id = v_project.id;

  insert into atlas.project_task_links (project_id, task_id, link_role, sort_order, source, metadata)
  values (v_project.id, v_task_id, 'belongs_to', v_sort_order, 'contributor', '{}'::jsonb);

  insert into atlas.project_steps (project_id, title, step_order, status, linked_task_id, note, metadata)
  values (v_project.id, btrim(p_title), v_sort_order, 'open', v_task_id, nullif(btrim(p_note), ''), jsonb_build_object('source','contributor_task'));

  update atlas.projects
  set last_movement_at = now(), updated_at = now()
  where id = v_project.id;

  return v_task_id;
end;
$$;

grant execute on function atlas.create_project_task_v1(uuid, text, date, text) to authenticated;

create or replace function atlas.complete_project_task_v1(p_task_id uuid, p_note text default null)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task record;
  v_project_id uuid;
  v_organization_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select t.*
  into v_task
  from atlas.tasks t
  where t.id = p_task_id;

  select ptl.project_id
  into v_project_id
  from atlas.project_task_links ptl
  where ptl.task_id = p_task_id
  order by ptl.created_at
  limit 1;

  if v_task.id is null or v_task.task_scope <> 'project' or v_project_id is null then
    raise exception 'Project task not found.' using errcode = 'P0002';
  end if;

  select p.organization_id into v_organization_id
  from atlas.projects p
  where p.id = v_project_id;

  if v_task.assigned_user_id is distinct from auth.uid()
     and not atlas.is_organization_owner(v_organization_id) then
    raise exception 'This project task is not assigned to the signed-in user.' using errcode = '42501';
  end if;

  update atlas.tasks
  set status = 'done',
      completed_at = now(),
      note = coalesce(nullif(btrim(p_note), ''), note),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'project_completed_at', now(),
        'project_completion_source', 'portfolio'
      ),
      updated_at = now()
  where id = p_task_id;

  update atlas.project_steps
  set status = 'done', completed_at = now(), updated_at = now()
  where linked_task_id = p_task_id;

  update atlas.projects
  set last_movement_at = now(), updated_at = now()
  where id = v_project_id;

  return p_task_id;
end;
$$;

grant execute on function atlas.complete_project_task_v1(uuid, text) to authenticated;

-- Seed the organization memberships without surfacing personal names in the portal.
insert into atlas.organization_memberships (organization_id, user_id, role, active, permissions)
select o.id, u.id, 'owner', true, jsonb_build_object('portfolio_scope','all','manage_projects',true)
from atlas.organizations o
join auth.users u on lower(u.email) = 'lexprjct@gmail.com'
where o.stable_key = 'feast_guild'
on conflict (organization_id, user_id) do update
set role = 'owner', active = true,
    permissions = atlas.organization_memberships.permissions || excluded.permissions,
    updated_at = now();

insert into atlas.organization_memberships (organization_id, user_id, role, active, permissions)
select o.id, u.id, 'consultant', true, jsonb_build_object('portfolio_scope','contributed_projects','create_own_project_tasks',true)
from atlas.organizations o
join auth.users u on lower(u.email) = 'kl@elmfarm.co'
where o.stable_key = 'feast_guild'
on conflict (organization_id, user_id) do update
set role = 'consultant', active = true,
    permissions = atlas.organization_memberships.permissions || excluded.permissions,
    updated_at = now();

update atlas.user_profiles p
set display_name = 'Katie',
    metadata = p.metadata || jsonb_build_object('portal','feast_guild','account_kind','consultant'),
    updated_at = now()
from auth.users u
where p.user_id = u.id
  and lower(u.email) = 'kl@elmfarm.co';

insert into atlas.farms (organization_id, stable_key, name, status, notes, metadata)
select
  o.id,
  'waiting_room_farm',
  'Waiting Room Farm',
  'active',
  'One-acre South Dakota recovery and rehabilitation property for elderly guests.',
  jsonb_build_object(
    'lot_size_acres', 1,
    'house_stories', 2,
    'has_basement', true,
    'standalone_garage_bays', 1,
    'property_purpose', 'Recovery and rehabilitation lodging for elderly guests, with the estate developed for walking and physical therapy.',
    'outdoor_mapping_status', 'not_yet_mapped'
  )
from atlas.organizations o
where o.stable_key = 'feast_guild'
on conflict (stable_key) do update
set organization_id = excluded.organization_id,
    name = excluded.name,
    status = excluded.status,
    notes = excluded.notes,
    metadata = atlas.farms.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.farm_memberships (user_id, farm_id, role, worker_key, active, permissions)
select u.id, f.id, 'owner', 'owner', true, jsonb_build_object('farm_scope','full')
from auth.users u
join atlas.farms f on f.stable_key = 'waiting_room_farm'
where lower(u.email) = 'lexprjct@gmail.com'
on conflict (user_id, farm_id) do update
set role = 'owner', worker_key = 'owner', active = true,
    permissions = atlas.farm_memberships.permissions || excluded.permissions,
    updated_at = now();

with farm as (
  select id from atlas.farms where stable_key = 'waiting_room_farm'
)
insert into atlas.places (farm_id, stable_key, label, place_type, facts, sort_order)
select farm.id, seed.stable_key, seed.label, seed.place_type, seed.facts, seed.sort_order
from farm
cross join (values
  ('main_house','Main House','house',jsonb_build_object('stories',2,'has_basement',true),10),
  ('standalone_garage','Standalone Garage','garage',jsonb_build_object('garage_bays',1,'standalone',true),40)
) as seed(stable_key,label,place_type,facts,sort_order)
on conflict (farm_id, stable_key) do update
set label = excluded.label,
    place_type = excluded.place_type,
    facts = atlas.places.facts || excluded.facts,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

with farm as (
  select id from atlas.farms where stable_key = 'waiting_room_farm'
), house as (
  select p.id, p.farm_id
  from atlas.places p
  join farm on farm.id = p.farm_id
  where p.stable_key = 'main_house'
)
insert into atlas.places (farm_id, parent_place_id, stable_key, label, place_type, facts, sort_order)
select house.farm_id, house.id, seed.stable_key, seed.label, seed.place_type, seed.facts, seed.sort_order
from house
cross join (values
  ('main_level_bedroom','Main Level Bedroom','room',jsonb_build_object('level','main','planned_use','Hospice guest bedroom'),20),
  ('basement','Basement','basement',jsonb_build_object('level','basement'),30)
) as seed(stable_key,label,place_type,facts,sort_order)
on conflict (farm_id, stable_key) do update
set parent_place_id = excluded.parent_place_id,
    label = excluded.label,
    place_type = excluded.place_type,
    facts = atlas.places.facts || excluded.facts,
    sort_order = excluded.sort_order,
    status = 'active',
    updated_at = now();

insert into atlas.projects (
  organization_id, farm_id, stable_key, title, status, goal_text, outcome_text,
  workstream, project_kind, current_milestone, health_status, sort_order,
  last_movement_at, metadata
)
select
  o.id, f.id, 'elm_airbnb_launch', 'Launch Elm on Airbnb', 'active',
  'Create and publish a complete Airbnb listing for Elm Farm.',
  'Elm has a complete, accurate, appealing, bookable Airbnb listing that advances Feast Guild hospitality and farm revenue.',
  'hospitality', 'farm', 'Build the first complete listing draft', 'moving', 10,
  now(), jsonb_build_object('project_subtype','lodging','created_from','portfolio_foundation_v1')
from atlas.organizations o
join atlas.farms f on f.stable_key = 'elm_farm'
where o.stable_key = 'feast_guild'
on conflict (organization_id, stable_key) do update
set farm_id = excluded.farm_id,
    title = excluded.title,
    status = excluded.status,
    goal_text = excluded.goal_text,
    outcome_text = excluded.outcome_text,
    workstream = excluded.workstream,
    project_kind = excluded.project_kind,
    current_milestone = excluded.current_milestone,
    health_status = excluded.health_status,
    sort_order = excluded.sort_order,
    metadata = atlas.projects.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.projects (
  organization_id, farm_id, stable_key, title, status, goal_text, outcome_text,
  workstream, project_kind, current_milestone, health_status, sort_order,
  last_movement_at, metadata
)
select
  o.id, f.id, 'waiting_room_ada_compliant_ward', 'ADA Compliant Ward', 'active',
  'Finish renovating the Main Level Bedroom for hospice lodging.',
  'The Main Level Bedroom is fully renovated and ready to house a hospice patient while medical professionals direct care.',
  'hospitality', 'farm', 'Finish the main-level bedroom renovation', 'moving', 20,
  now(), jsonb_build_object(
    'project_subtype','recovery_and_care',
    'scope_boundary','Bedroom renovation only; the rest of the property route and facilities are already compliant.',
    'medical_records_policy','Atlas records property readiness, not medical records.',
    'created_from','portfolio_foundation_v1'
  )
from atlas.organizations o
join atlas.farms f on f.stable_key = 'waiting_room_farm'
where o.stable_key = 'feast_guild'
on conflict (organization_id, stable_key) do update
set farm_id = excluded.farm_id,
    title = excluded.title,
    status = excluded.status,
    goal_text = excluded.goal_text,
    outcome_text = excluded.outcome_text,
    workstream = excluded.workstream,
    project_kind = excluded.project_kind,
    current_milestone = excluded.current_milestone,
    health_status = excluded.health_status,
    sort_order = excluded.sort_order,
    metadata = atlas.projects.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.projects (
  organization_id, farm_id, stable_key, title, status, goal_text, outcome_text,
  workstream, project_kind, current_milestone, health_status, sort_order,
  last_movement_at, metadata
)
select
  o.id, null, 'rehabilitation_house_funding_caregiver_pathways',
  'Rehabilitation House Funding + Caregiver Pathways', 'active',
  'Research funding, training, paid-caregiver pathways, and institutional support that could help a rehabilitation house.',
  'Feast Guild has a reusable understanding of funding, training, and paid-caregiver pathways that may support rehabilitation houses across farms.',
  'hospitality', 'cross_farm', 'Define the research trail and available pathways', 'moving', 30,
  now(), jsonb_build_object(
    'project_subtype','research',
    'jurisdiction_scope','broad',
    'future_reuse','cross_farm',
    'created_from','portfolio_foundation_v1'
  )
from atlas.organizations o
where o.stable_key = 'feast_guild'
on conflict (organization_id, stable_key) do update
set farm_id = null,
    title = excluded.title,
    status = excluded.status,
    goal_text = excluded.goal_text,
    outcome_text = excluded.outcome_text,
    workstream = excluded.workstream,
    project_kind = excluded.project_kind,
    current_milestone = excluded.current_milestone,
    health_status = excluded.health_status,
    sort_order = excluded.sort_order,
    metadata = atlas.projects.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.project_contributors (
  project_id, user_id, contribution_role, active,
  can_create_tasks, can_complete_tasks, can_submit_results, permissions
)
select p.id, u.id, 'lead', true, true, true, true, jsonb_build_object('final_decision',true)
from atlas.projects p
join auth.users u on lower(u.email) = 'lexprjct@gmail.com'
where p.organization_id = (select id from atlas.organizations where stable_key = 'feast_guild')
  and p.stable_key in (
    'elm_airbnb_launch',
    'waiting_room_ada_compliant_ward',
    'rehabilitation_house_funding_caregiver_pathways'
  )
on conflict (project_id, user_id) do update
set contribution_role = 'lead', active = true,
    can_create_tasks = true, can_complete_tasks = true, can_submit_results = true,
    permissions = atlas.project_contributors.permissions || excluded.permissions,
    updated_at = now();

insert into atlas.project_contributors (
  project_id, user_id, contribution_role, active,
  can_create_tasks, can_complete_tasks, can_submit_results, permissions
)
select p.id, u.id, 'contributor', true, true, true, true,
       jsonb_build_object('context_scope','project_and_explicit_targets')
from atlas.projects p
join auth.users u on lower(u.email) = 'kl@elmfarm.co'
where p.organization_id = (select id from atlas.organizations where stable_key = 'feast_guild')
  and p.stable_key in ('elm_airbnb_launch','rehabilitation_house_funding_caregiver_pathways')
on conflict (project_id, user_id) do update
set contribution_role = 'contributor', active = true,
    can_create_tasks = true, can_complete_tasks = true, can_submit_results = true,
    permissions = atlas.project_contributors.permissions || excluded.permissions,
    updated_at = now();

insert into atlas.project_targets (project_id, farm_id, target_role, metadata)
select p.id, p.farm_id, 'primary_farm', '{}'::jsonb
from atlas.projects p
where p.stable_key = 'elm_airbnb_launch'
  and p.farm_id is not null
  and not exists (
    select 1 from atlas.project_targets pt
    where pt.project_id = p.id and pt.farm_id = p.farm_id and pt.target_role = 'primary_farm'
  );

insert into atlas.project_targets (project_id, farm_id, place_id, target_role, metadata)
select p.id, p.farm_id, pl.id, 'renovation_scope',
       jsonb_build_object('scope','Bedroom renovation only')
from atlas.projects p
join atlas.places pl on pl.farm_id = p.farm_id and pl.stable_key = 'main_level_bedroom'
where p.stable_key = 'waiting_room_ada_compliant_ward'
  and not exists (
    select 1 from atlas.project_targets pt
    where pt.project_id = p.id and pt.place_id = pl.id and pt.target_role = 'renovation_scope'
  );

-- Initial project work for the consultant account.
with context as (
  select
    p.id as project_id,
    p.organization_id,
    p.farm_id,
    owner_user.id as owner_user_id,
    contributor_user.id as contributor_user_id
  from atlas.projects p
  join auth.users owner_user on lower(owner_user.email) = 'lexprjct@gmail.com'
  join auth.users contributor_user on lower(contributor_user.email) = 'kl@elmfarm.co'
  where p.stable_key = 'elm_airbnb_launch'
), inserted as (
  insert into atlas.tasks (
    organization_id, farm_id, task_scope, title, task_type, status, priority,
    visibility_scope, assigned_user_id, created_by_user_id, origin_kind, metadata
  )
  select organization_id, farm_id, 'project',
    'Build the first complete Elm Airbnb listing draft', 'project', 'open', 'normal',
    'project_shared', contributor_user_id, owner_user_id, 'owner_assigned',
    jsonb_build_object('project_task',true,'project_id',project_id,'workstream','hospitality','assigned_role','contributor')
  from context
  where not exists (
    select 1 from atlas.project_task_links ptl
    join atlas.tasks t on t.id = ptl.task_id
    where ptl.project_id = context.project_id
      and lower(t.title) = lower('Build the first complete Elm Airbnb listing draft')
      and t.status <> 'archived'
  )
  returning id
)
insert into atlas.project_task_links (project_id, task_id, link_role, sort_order, source, metadata)
select context.project_id, inserted.id, 'belongs_to', 10, 'owner_assigned', '{}'::jsonb
from context cross join inserted
on conflict (project_id, task_id) do nothing;

insert into atlas.project_steps (project_id, title, step_order, status, linked_task_id, metadata)
select p.id, t.title, 10, t.status, t.id, jsonb_build_object('source','owner_assigned_project_task')
from atlas.projects p
join atlas.project_task_links ptl on ptl.project_id = p.id
join atlas.tasks t on t.id = ptl.task_id
where p.stable_key = 'elm_airbnb_launch'
  and lower(t.title) = lower('Build the first complete Elm Airbnb listing draft')
  and not exists (
    select 1 from atlas.project_steps ps
    where ps.project_id = p.id and ps.linked_task_id = t.id
  );

with context as (
  select
    p.id as project_id,
    p.organization_id,
    p.farm_id,
    owner_user.id as owner_user_id,
    contributor_user.id as contributor_user_id
  from atlas.projects p
  join auth.users owner_user on lower(owner_user.email) = 'lexprjct@gmail.com'
  join auth.users contributor_user on lower(contributor_user.email) = 'kl@elmfarm.co'
  where p.stable_key = 'rehabilitation_house_funding_caregiver_pathways'
), inserted as (
  insert into atlas.tasks (
    organization_id, farm_id, task_scope, title, task_type, status, priority,
    visibility_scope, assigned_user_id, created_by_user_id, origin_kind, metadata
  )
  select organization_id, farm_id, 'project',
    'Research rehabilitation-house funding, training, and paid family caregiver pathways',
    'project', 'open', 'normal', 'project_shared', contributor_user_id, owner_user_id,
    'owner_assigned',
    jsonb_build_object('project_task',true,'project_id',project_id,'workstream','hospitality','assigned_role','contributor','research_scope','broad')
  from context
  where not exists (
    select 1 from atlas.project_task_links ptl
    join atlas.tasks t on t.id = ptl.task_id
    where ptl.project_id = context.project_id
      and lower(t.title) = lower('Research rehabilitation-house funding, training, and paid family caregiver pathways')
      and t.status <> 'archived'
  )
  returning id
)
insert into atlas.project_task_links (project_id, task_id, link_role, sort_order, source, metadata)
select context.project_id, inserted.id, 'belongs_to', 10, 'owner_assigned', '{}'::jsonb
from context cross join inserted
on conflict (project_id, task_id) do nothing;

insert into atlas.project_steps (project_id, title, step_order, status, linked_task_id, metadata)
select p.id, t.title, 10, t.status, t.id, jsonb_build_object('source','owner_assigned_project_task')
from atlas.projects p
join atlas.project_task_links ptl on ptl.project_id = p.id
join atlas.tasks t on t.id = ptl.task_id
where p.stable_key = 'rehabilitation_house_funding_caregiver_pathways'
  and lower(t.title) = lower('Research rehabilitation-house funding, training, and paid family caregiver pathways')
  and not exists (
    select 1 from atlas.project_steps ps
    where ps.project_id = p.id and ps.linked_task_id = t.id
  );
