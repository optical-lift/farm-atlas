-- Marshall needs to see this Elm event as one whole project, including Owner work
-- that can block Anna's execution. Keep his portfolio scope restricted to projects
-- where he is explicitly listed as a contributor.

with target as (
  select
    p.id as project_id,
    p.organization_id,
    fm.user_id
  from atlas.projects p
  join atlas.farm_memberships fm
    on fm.farm_id = p.farm_id
   and fm.active = true
   and fm.worker_key = 'marshall'
  where p.stable_key = 'elm_first_ticketed_thursday_bloom_bar_2026_08_13'
  limit 1
)
insert into atlas.organization_memberships (
  organization_id,
  user_id,
  role,
  active,
  permissions
)
select
  organization_id,
  user_id,
  'member',
  true,
  jsonb_build_object(
    'portfolio_scope', 'contributed_projects',
    'project_visibility', 'full_project'
  )
from target
on conflict (organization_id, user_id) do update
set active = true,
    role = 'member',
    permissions = atlas.organization_memberships.permissions || excluded.permissions,
    updated_at = now();

with target as (
  select
    p.id as project_id,
    fm.user_id
  from atlas.projects p
  join atlas.farm_memberships fm
    on fm.farm_id = p.farm_id
   and fm.active = true
   and fm.worker_key = 'marshall'
  where p.stable_key = 'elm_first_ticketed_thursday_bloom_bar_2026_08_13'
  limit 1
)
insert into atlas.project_contributors (
  project_id,
  user_id,
  contribution_role,
  active,
  can_create_tasks,
  can_complete_tasks,
  can_submit_results,
  permissions
)
select
  project_id,
  user_id,
  'reviewer',
  true,
  false,
  false,
  false,
  jsonb_build_object(
    'purpose', 'cross_role_dependency_visibility',
    'view_scope', 'full_project'
  )
from target
on conflict (project_id, user_id) do update
set contribution_role = 'reviewer',
    active = true,
    can_create_tasks = false,
    can_complete_tasks = false,
    can_submit_results = false,
    permissions = atlas.project_contributors.permissions || excluded.permissions,
    updated_at = now();
