-- Universal Trail task release, duplicate prevention, and dashboard pulse.

create table if not exists atlas.trail_task_releases (
  id uuid primary key default gen_random_uuid(),
  trail_binding_id uuid not null references atlas.trail_bindings(id) on delete cascade,
  node_key text not null,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  release_role text not null default 'supporting' check (release_role in ('current','supporting')),
  release_status text not null default 'active' check (release_status in ('active','completed','cancelled','superseded')),
  released_at timestamptz not null default now(),
  released_by_user_id uuid references auth.users(id) on delete set null,
  completed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trail_binding_id, node_key, task_id)
);

create unique index if not exists trail_task_releases_one_active_current_idx
  on atlas.trail_task_releases(trail_binding_id)
  where release_status = 'active' and release_role = 'current';

create index if not exists trail_task_releases_node_idx
  on atlas.trail_task_releases(trail_binding_id, node_key, release_status, release_role, released_at);

create index if not exists trail_task_releases_task_idx
  on atlas.trail_task_releases(task_id, release_status);

alter table atlas.trail_task_releases enable row level security;

drop policy if exists trail_task_releases_read_visible on atlas.trail_task_releases;
create policy trail_task_releases_read_visible on atlas.trail_task_releases
for select to authenticated
using (atlas.can_read_trail_binding_v1(trail_binding_id));

grant select on atlas.trail_task_releases to authenticated;
revoke all on atlas.trail_task_releases from anon;

create or replace function atlas.can_release_trail_task_v1(p_binding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select auth.uid() is not null and exists (
    select 1
    from atlas.trail_bindings b
    where b.id = p_binding_id
      and b.status in ('active','paused')
      and (
        atlas.is_organization_owner(b.organization_id)
        or (b.subject_kind = 'project' and atlas.can_contribute_to_project(b.subject_id))
        or (b.farm_id is not null and atlas.current_farm_role(b.farm_id) in ('owner','manager'))
      )
  );
$$;

grant execute on function atlas.can_release_trail_task_v1(uuid) to authenticated;
revoke all on function atlas.can_release_trail_task_v1(uuid) from anon;

create or replace function atlas.promote_next_trail_release_v1(
  p_binding_id uuid,
  p_node_key text
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_release_id uuid;
  v_task_id uuid;
begin
  select r.task_id into v_task_id
  from atlas.trail_task_releases r
  where r.trail_binding_id = p_binding_id
    and r.node_key = p_node_key
    and r.release_status = 'active'
    and r.release_role = 'current'
  order by r.released_at, r.created_at
  limit 1;

  if v_task_id is not null then
    return v_task_id;
  end if;

  select r.id, r.task_id into v_release_id, v_task_id
  from atlas.trail_task_releases r
  where r.trail_binding_id = p_binding_id
    and r.node_key = p_node_key
    and r.release_status = 'active'
    and r.release_role = 'supporting'
  order by r.released_at, r.created_at
  limit 1
  for update;

  if v_release_id is not null then
    update atlas.trail_task_releases
    set release_role = 'current',
        metadata = metadata || jsonb_build_object('promoted_at', now()),
        updated_at = now()
    where id = v_release_id;
  end if;

  return v_task_id;
end;
$$;

revoke all on function atlas.promote_next_trail_release_v1(uuid, text) from public, anon, authenticated;

create or replace function atlas.release_project_task_to_current_trail_v1(
  p_project_id uuid,
  p_task_id uuid,
  p_release_role text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_binding record;
  v_task record;
  v_role text := nullif(lower(btrim(coalesce(p_release_role, ''))), '');
  v_existing_current uuid;
  v_release_id uuid;
  v_step_id uuid;
  v_updated integer;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_role is not null and v_role not in ('current','supporting') then
    raise exception 'Unsupported Trail release role.' using errcode = '22023';
  end if;

  select b.id, b.profile_id, b.current_node_key, tp.stable_key as profile_key, n.node_order
  into v_binding
  from atlas.trail_bindings b
  join atlas.trail_profiles tp on tp.id = b.profile_id
  join atlas.trail_profile_nodes n
    on n.profile_id = b.profile_id
   and n.node_key = b.current_node_key
  where b.subject_kind = 'project'
    and b.subject_id = p_project_id
    and b.status = 'active'
  limit 1;

  if v_binding.id is null or v_binding.current_node_key is null then
    raise exception 'This project does not have an active Trail position.' using errcode = 'P0002';
  end if;

  if not atlas.can_release_trail_task_v1(v_binding.id) then
    raise exception 'Trail release access is not active.' using errcode = '42501';
  end if;

  select t.* into v_task
  from atlas.project_task_links ptl
  join atlas.tasks t on t.id = ptl.task_id
  where ptl.project_id = p_project_id
    and ptl.task_id = p_task_id
    and t.task_scope = 'project'
  order by ptl.created_at
  limit 1;

  if v_task.id is null then
    raise exception 'Project task not found.' using errcode = 'P0002';
  end if;

  if v_task.status not in ('open','blocked') then
    raise exception 'Only open or blocked work can be released.' using errcode = '22023';
  end if;

  select r.task_id into v_existing_current
  from atlas.trail_task_releases r
  where r.trail_binding_id = v_binding.id
    and r.release_status = 'active'
    and r.release_role = 'current'
  order by r.released_at, r.created_at
  limit 1;

  if v_role is null then
    v_role := case when v_existing_current is null then 'current' else 'supporting' end;
  elsif v_role = 'current' and v_existing_current is not null and v_existing_current <> p_task_id then
    raise exception 'This Trail already has a current released task.' using errcode = '23505';
  end if;

  update atlas.project_steps
  set step_order = v_binding.node_order,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'trail_node_key', v_binding.current_node_key,
        'trail_profile_key', v_binding.profile_key,
        'trail_release_role', v_role,
        'release_source', 'trail_task_release_v1'
      ),
      updated_at = now()
  where project_id = p_project_id
    and linked_task_id = p_task_id
  returning id into v_step_id;

  get diagnostics v_updated = row_count;

  if v_updated = 0 then
    insert into atlas.project_steps (
      project_id, title, step_order, status, linked_task_id, note, metadata
    ) values (
      p_project_id,
      v_task.title,
      v_binding.node_order,
      case when v_task.status = 'blocked' then 'blocked' else 'open' end,
      p_task_id,
      v_task.note,
      jsonb_build_object(
        'trail_node_key', v_binding.current_node_key,
        'trail_profile_key', v_binding.profile_key,
        'trail_release_role', v_role,
        'release_source', 'trail_task_release_v1'
      )
    ) returning id into v_step_id;
  end if;

  insert into atlas.trail_task_releases (
    trail_binding_id, node_key, task_id, release_role, release_status,
    released_by_user_id, metadata
  ) values (
    v_binding.id,
    v_binding.current_node_key,
    p_task_id,
    v_role,
    'active',
    auth.uid(),
    jsonb_build_object('project_id', p_project_id, 'project_step_id', v_step_id)
  )
  on conflict (trail_binding_id, node_key, task_id) do update
  set release_role = excluded.release_role,
      release_status = 'active',
      completed_at = null,
      released_by_user_id = coalesce(excluded.released_by_user_id, atlas.trail_task_releases.released_by_user_id),
      metadata = atlas.trail_task_releases.metadata || excluded.metadata,
      updated_at = now()
  returning id into v_release_id;

  return v_release_id;
end;
$$;

grant execute on function atlas.release_project_task_to_current_trail_v1(uuid, uuid, text) to authenticated;
revoke all on function atlas.release_project_task_to_current_trail_v1(uuid, uuid, text) from anon;

-- Seed the currently released project tasks without hardcoding generated IDs.
insert into atlas.trail_task_releases (
  trail_binding_id, node_key, task_id, release_role, release_status,
  released_by_user_id, completed_at, metadata
)
select
  b.id,
  b.current_node_key,
  candidate.linked_task_id,
  'current',
  case when candidate.task_status in ('done','skipped') then 'completed' else 'active' end,
  candidate.created_by_user_id,
  case when candidate.task_status in ('done','skipped') then candidate.completed_at else null end,
  jsonb_build_object('source','current_project_task_seed','project_id',b.subject_id,'project_step_id',candidate.step_id)
from atlas.trail_bindings b
join lateral (
  select
    ps.id as step_id,
    ps.linked_task_id,
    t.status as task_status,
    t.created_by_user_id,
    t.completed_at
  from atlas.project_steps ps
  join atlas.tasks t on t.id = ps.linked_task_id
  join atlas.trail_profile_nodes n
    on n.profile_id = b.profile_id
   and n.node_key = b.current_node_key
  where ps.project_id = b.subject_id
    and b.subject_kind = 'project'
    and (
      ps.metadata ->> 'trail_node_key' = b.current_node_key
      or ps.step_order = n.node_order
    )
    and t.task_scope = 'project'
  order by
    case when ps.metadata ->> 'trail_node_key' = b.current_node_key then 0 else 1 end,
    case when t.status in ('open','blocked') then 0 else 1 end,
    ps.created_at
  limit 1
) candidate on true
where b.subject_kind = 'project'
  and b.status = 'active'
  and b.current_node_key is not null
on conflict (trail_binding_id, node_key, task_id) do update
set release_role = 'current',
    release_status = excluded.release_status,
    completed_at = excluded.completed_at,
    metadata = atlas.trail_task_releases.metadata || excluded.metadata,
    updated_at = now();

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
  v_binding record;
  v_step_id uuid;
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
    organization_id, farm_id, task_scope, title, task_type, status, priority,
    due_date, note, visibility_scope, assigned_user_id, created_by_user_id,
    origin_kind, metadata
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

  select b.id, b.current_node_key, n.node_order, tp.stable_key as profile_key
  into v_binding
  from atlas.trail_bindings b
  join atlas.trail_profiles tp on tp.id = b.profile_id
  join atlas.trail_profile_nodes n
    on n.profile_id = b.profile_id
   and n.node_key = b.current_node_key
  where b.subject_kind = 'project'
    and b.subject_id = v_project.id
    and b.status = 'active'
  limit 1;

  insert into atlas.project_steps (project_id, title, step_order, status, linked_task_id, note, metadata)
  values (
    v_project.id,
    btrim(p_title),
    coalesce(v_binding.node_order, v_sort_order),
    'open',
    v_task_id,
    nullif(btrim(p_note), ''),
    case when v_binding.id is null then
      jsonb_build_object('source','contributor_task')
    else
      jsonb_build_object(
        'source','contributor_task',
        'trail_node_key',v_binding.current_node_key,
        'trail_profile_key',v_binding.profile_key
      )
    end
  ) returning id into v_step_id;

  if v_binding.id is not null then
    perform atlas.release_project_task_to_current_trail_v1(v_project.id, v_task_id, null);
  end if;

  update atlas.projects
  set last_movement_at = now(), updated_at = now()
  where id = v_project.id;

  return v_task_id;
end;
$$;

create or replace function atlas.complete_project_task_v1(
  p_task_id uuid,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task record;
  v_project_id uuid;
  v_organization_id uuid;
  v_release atlas.trail_task_releases%rowtype;
  v_active_release_count integer := 0;
  v_next_node_key text;
  v_next_node_label text;
  v_promoted_task_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select t.* into v_task from atlas.tasks t where t.id = p_task_id for update;

  select ptl.project_id into v_project_id
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
      completed_at = coalesce(completed_at, now()),
      blocker_text = null,
      note = coalesce(nullif(btrim(p_note), ''), note),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'project_completed_at', now(),
        'project_completion_source', 'universal_task_focus'
      ),
      updated_at = now()
  where id = p_task_id;

  update atlas.project_steps
  set status = 'done',
      completed_at = coalesce(completed_at, now()),
      note = coalesce(nullif(btrim(p_note), ''), note),
      updated_at = now()
  where project_id = v_project_id and linked_task_id = p_task_id;

  select r.* into v_release
  from atlas.trail_task_releases r
  join atlas.trail_bindings b on b.id = r.trail_binding_id
  where r.task_id = p_task_id
    and b.subject_kind = 'project'
    and b.subject_id = v_project_id
  order by case when r.release_status = 'active' then 0 else 1 end, r.released_at
  limit 1;

  if v_release.id is not null then
    update atlas.trail_task_releases
    set release_status = 'completed',
        completed_at = coalesce(completed_at, now()),
        metadata = metadata || jsonb_build_object('completion_source','complete_project_task_v1'),
        updated_at = now()
    where id = v_release.id;

    insert into atlas.trail_evidence_links (
      trail_binding_id, node_key, source_type, source_id, evidence_status,
      link_method, confidence, occurred_at, confirmed_by_user_id, confirmed_at, metadata
    ) values (
      v_release.trail_binding_id,
      v_release.node_key,
      'project_task',
      p_task_id::text,
      'accepted',
      'direct',
      1,
      now(),
      auth.uid(),
      now(),
      jsonb_build_object('project_id',v_project_id,'completion_source','complete_project_task_v1')
    )
    on conflict (trail_binding_id, node_key, source_type, source_id) do update
    set evidence_status = 'accepted',
        occurred_at = excluded.occurred_at,
        confirmed_by_user_id = excluded.confirmed_by_user_id,
        confirmed_at = excluded.confirmed_at,
        metadata = atlas.trail_evidence_links.metadata || excluded.metadata,
        updated_at = now();

    if v_release.release_role = 'current' then
      v_promoted_task_id := atlas.promote_next_trail_release_v1(v_release.trail_binding_id, v_release.node_key);
    end if;

    select count(*)::integer into v_active_release_count
    from atlas.trail_task_releases r
    where r.trail_binding_id = v_release.trail_binding_id
      and r.node_key = v_release.node_key
      and r.release_status = 'active';

    if v_active_release_count = 0 and exists (
      select 1
      from atlas.trail_bindings b
      where b.id = v_release.trail_binding_id
        and b.current_node_key = v_release.node_key
        and b.status = 'active'
    ) then
      select n.node_key, n.label
      into v_next_node_key, v_next_node_label
      from atlas.trail_bindings b
      join atlas.trail_profile_nodes current_node
        on current_node.profile_id = b.profile_id
       and current_node.node_key = v_release.node_key
      join atlas.trail_profile_nodes n
        on n.profile_id = b.profile_id
       and n.node_order > current_node.node_order
      where b.id = v_release.trail_binding_id
      order by n.node_order
      limit 1;

      update atlas.trail_bindings
      set current_node_key = v_next_node_key,
          status = case when v_next_node_key is null then 'complete' else 'active' end,
          metadata = metadata || jsonb_build_object(
            'last_completed_node_key', v_release.node_key,
            'last_advanced_at', now(),
            'last_advance_source_task_id', p_task_id
          ),
          updated_at = now()
      where id = v_release.trail_binding_id
        and current_node_key = v_release.node_key;
    end if;
  end if;

  update atlas.projects
  set last_movement_at = now(),
      current_milestone = case
        when v_next_node_key is not null then v_next_node_label
        when v_release.id is not null and v_active_release_count = 0 then current_milestone
        else current_milestone
      end,
      health_status = case
        when v_release.id is not null and v_active_release_count = 0 and v_next_node_key is null then 'complete'
        else 'moving'
      end,
      updated_at = now()
  where id = v_project_id;

  return p_task_id;
end;
$$;

create or replace function atlas.transition_project_task_v1(
  p_task_id uuid,
  p_transition text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_task record;
  v_project_id uuid;
  v_organization_id uuid;
  v_transition text := lower(coalesce(p_transition, ''));
  v_status text;
  v_step_status text;
  v_health text;
  v_release record;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  if v_transition not in ('done','partial','blocked','not_relevant','changed_plan') then
    raise exception 'Unsupported project task transition.' using errcode = '22023';
  end if;

  if v_transition = 'done' then
    return atlas.complete_project_task_v1(p_task_id, p_note);
  end if;

  select t.* into v_task from atlas.tasks t where t.id = p_task_id;

  select ptl.project_id into v_project_id
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

  v_status := case
    when v_transition = 'blocked' then 'blocked'
    when v_transition in ('not_relevant','changed_plan') then 'skipped'
    else 'open'
  end;
  v_step_status := v_status;
  v_health := case
    when v_transition = 'blocked' then 'blocked'
    when v_transition = 'partial' then 'waiting'
    else 'moving'
  end;

  update atlas.tasks
  set status = v_status,
      completed_at = case when v_status = 'skipped' then coalesce(completed_at, now()) else null end,
      blocker_text = case when v_transition = 'blocked' then coalesce(nullif(btrim(p_note), ''), 'Blocked') else null end,
      note = coalesce(nullif(btrim(p_note), ''), note),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'project_task_last_outcome', v_transition,
        'project_task_last_outcome_at', now(),
        'project_task_transition_source', 'universal_task_focus'
      ),
      updated_at = now()
  where id = p_task_id;

  update atlas.project_steps
  set status = v_step_status,
      completed_at = case when v_status = 'skipped' then coalesce(completed_at, now()) else null end,
      note = coalesce(nullif(btrim(p_note), ''), note),
      updated_at = now()
  where project_id = v_project_id and linked_task_id = p_task_id;

  select r.id, r.trail_binding_id, r.node_key, r.release_role
  into v_release
  from atlas.trail_task_releases r
  join atlas.trail_bindings b on b.id = r.trail_binding_id
  where r.task_id = p_task_id
    and b.subject_kind = 'project'
    and b.subject_id = v_project_id
  order by case when r.release_status = 'active' then 0 else 1 end, r.released_at
  limit 1;

  if v_release.id is not null then
    if v_status = 'skipped' then
      update atlas.trail_task_releases
      set release_status = 'cancelled',
          completed_at = coalesce(completed_at, now()),
          metadata = metadata || jsonb_build_object('cancelled_by_transition',v_transition),
          updated_at = now()
      where id = v_release.id;

      if v_release.release_role = 'current' then
        perform atlas.promote_next_trail_release_v1(v_release.trail_binding_id, v_release.node_key);
      end if;
    else
      update atlas.trail_task_releases
      set release_status = 'active',
          completed_at = null,
          updated_at = now()
      where id = v_release.id;
    end if;
  end if;

  update atlas.projects
  set last_movement_at = now(),
      health_status = v_health,
      updated_at = now()
  where id = v_project_id;

  return p_task_id;
end;
$$;

grant execute on function atlas.create_project_task_v1(uuid, text, date, text) to authenticated;
grant execute on function atlas.complete_project_task_v1(uuid, text) to authenticated;
grant execute on function atlas.transition_project_task_v1(uuid, text, text) to authenticated;
revoke all on function atlas.create_project_task_v1(uuid, text, date, text) from anon;
revoke all on function atlas.complete_project_task_v1(uuid, text) from anon;
revoke all on function atlas.transition_project_task_v1(uuid, text, text) from anon;

create or replace function atlas.project_trail_context_v2(p_project_id uuid)
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
    raise exception 'Project Trail access is not active.' using errcode = '42501';
  end if;

  with binding as (
    select b.*, tp.stable_key as profile_key, tp.label as profile_label,
           p.title as project_title, p.farm_id as project_farm_id,
           p.last_movement_at as project_last_movement_at
    from atlas.trail_bindings b
    join atlas.trail_profiles tp on tp.id = b.profile_id
    join atlas.projects p on p.id = b.subject_id
    where b.subject_kind = 'project'
      and b.subject_id = p_project_id
      and b.status <> 'archived'
    limit 1
  ), node_source as (
    select
      b.id as binding_id,
      b.profile_key,
      b.profile_label,
      b.project_title,
      b.project_farm_id,
      b.current_node_key,
      b.project_last_movement_at,
      n.id as node_id,
      n.node_key,
      n.label,
      n.node_order,
      n.node_kind,
      rel.release_id,
      rel.release_role,
      rel.release_status,
      rel.linked_task_id,
      rel.task_title,
      rel.task_status,
      rel.task_due_date,
      coalesce(rel.project_step_id, projection.id) as project_step_id,
      coalesce(rel.project_step_status, projection.status) as project_step_status,
      coalesce(rel.project_step_note, projection.note) as project_step_note,
      coalesce(active_releases.active_count, 0) as active_release_count,
      coalesce(ev.accepted_count, 0) as accepted_count,
      ev.last_evidence_at
    from binding b
    join atlas.trail_profile_nodes n on n.profile_id = b.profile_id
    left join lateral (
      select
        r.id as release_id,
        r.release_role,
        r.release_status,
        r.task_id as linked_task_id,
        t.title as task_title,
        t.status as task_status,
        t.due_date as task_due_date,
        ps.id as project_step_id,
        ps.status as project_step_status,
        ps.note as project_step_note
      from atlas.trail_task_releases r
      join atlas.tasks t on t.id = r.task_id
      left join lateral (
        select candidate.*
        from atlas.project_steps candidate
        where candidate.project_id = p_project_id
          and candidate.linked_task_id = r.task_id
        order by candidate.created_at
        limit 1
      ) ps on true
      where r.trail_binding_id = b.id
        and r.node_key = n.node_key
      order by
        case
          when r.release_status = 'active' and r.release_role = 'current' then 0
          when r.release_status = 'active' then 1
          when r.release_status = 'completed' then 2
          else 3
        end,
        r.released_at,
        r.created_at
      limit 1
    ) rel on true
    left join lateral (
      select count(*)::integer as active_count
      from atlas.trail_task_releases r
      where r.trail_binding_id = b.id
        and r.node_key = n.node_key
        and r.release_status = 'active'
    ) active_releases on true
    left join lateral (
      select candidate.*
      from atlas.project_steps candidate
      where candidate.project_id = p_project_id
        and (
          candidate.metadata ->> 'trail_node_key' = n.node_key
          or candidate.step_order = n.node_order
        )
      order by
        case when candidate.metadata ->> 'trail_node_key' = n.node_key then 0 else 1 end,
        case when candidate.linked_task_id is not null then 0 else 1 end,
        candidate.created_at
      limit 1
    ) projection on true
    left join lateral (
      select count(*)::integer as accepted_count, max(e.occurred_at) as last_evidence_at
      from atlas.trail_evidence_links e
      where e.trail_binding_id = b.id
        and e.node_key = n.node_key
        and e.evidence_status = 'accepted'
    ) ev on true
  ), current_order as (
    select node_order
    from node_source
    where node_key = current_node_key
    limit 1
  ), resolved as (
    select ns.*,
      case
        when ns.node_key = ns.current_node_key and ns.task_status = 'blocked' then 'blocked'
        when ns.node_key = ns.current_node_key then 'current'
        when ns.accepted_count > 0 then 'complete'
        when ns.node_order < coalesce((select node_order from current_order), ns.node_order) then 'unresolved'
        when ns.project_step_status = 'skipped' then 'skipped'
        when ns.node_kind = 'care_pulse' then 'care'
        else 'projected'
      end as resolved_status
    from node_source ns
  ), current_row as (
    select * from resolved where node_key = current_node_key limit 1
  ), next_row as (
    select r.*
    from resolved r
    where r.node_order > coalesce((select node_order from current_order), -1)
      and r.resolved_status not in ('complete','skipped')
    order by r.node_order
    limit 1
  )
  select jsonb_strip_nulls(jsonb_build_object(
    'trailId', b.id,
    'profileKey', b.profile_key,
    'profileLabel', b.profile_label,
    'subject', jsonb_build_object(
      'kind', 'project',
      'id', p_project_id,
      'label', b.project_title,
      'farmId', b.project_farm_id
    ),
    'nodes', coalesce((
      select jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'nodeId', r.node_id,
        'nodeKey', r.node_key,
        'label', r.label,
        'status', r.resolved_status,
        'nodeKind', r.node_kind,
        'occurredOn', r.last_evidence_at,
        'dueOn', r.task_due_date,
        'taskId', case
          when r.resolved_status in ('current','blocked')
           and r.release_status = 'active'
           and r.release_role = 'current'
          then r.linked_task_id
          else null
        end,
        'evidenceCount', r.accepted_count,
        'note', case when r.resolved_status in ('current','blocked') then r.project_step_note else null end
      )) order by r.node_order)
      from resolved r
    ), '[]'::jsonb),
    'currentNodeId', (select node_id from current_row),
    'currentMove', (
      select case
        when linked_task_id is null or release_status <> 'active' or release_role <> 'current' then null
        else jsonb_strip_nulls(jsonb_build_object(
          'kind','project_task',
          'taskId',linked_task_id,
          'title',coalesce(task_title,label),
          'status',coalesce(task_status,project_step_status),
          'dueDate',task_due_date,
          'href','/task-focus/' || linked_task_id::text || '?returnTo=' ||
            replace('/project/' || p_project_id::text, '/', '%2F')
        ))
      end
      from current_row
    ),
    'nextNode', (
      select jsonb_build_object(
        'nodeId',node_id,'nodeKey',node_key,'label',label,
        'status',resolved_status,'nodeKind',node_kind
      ) from next_row
    ),
    'blocker', coalesce(
      (select case when resolved_status = 'blocked' then jsonb_build_object(
        'kind','blocked_move','title',coalesce(task_title,label),
        'detail',coalesce(project_step_note,'The current move is blocked.')
      ) else null end from current_row),
      (select jsonb_build_object(
        'kind',pai.attention_type,'title',pai.title,'detail',pai.detail,'dueDate',pai.due_date
      )
       from atlas.project_attention_items pai
       where pai.project_id = p_project_id and pai.status = 'open'
         and pai.attention_type in ('blocked','decision','review','missing_information','external_dependency')
       order by pai.due_date nulls last, pai.created_at
       limit 1)
    ),
    'unresolvedEvidenceCount',
      (select count(*)::integer from resolved where resolved_status = 'unresolved')
      + (select count(*)::integer from atlas.trail_evidence_links e
         where e.trail_binding_id = b.id and e.evidence_status = 'pending'),
    'evidenceCount', (select coalesce(sum(accepted_count),0)::integer from resolved),
    'lastMovedAt', greatest(
      b.project_last_movement_at,
      (select max(last_evidence_at) from resolved)
    )
  )) into v_result
  from binding b;

  return v_result;
end;
$$;

grant execute on function atlas.project_trail_context_v2(uuid) to authenticated;
revoke all on function atlas.project_trail_context_v2(uuid) from anon;

create or replace function atlas.universal_trail_pulse_v1(p_organization_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  with visible as (
    select
      b.id as binding_id,
      b.organization_id,
      b.farm_id,
      b.subject_kind,
      b.subject_id,
      b.status as binding_status,
      b.current_node_key,
      tp.stable_key as profile_key,
      tp.label as profile_label,
      n.label as current_node_label,
      n.node_kind,
      p.title as project_title,
      f.name as farm_name,
      o.name as organization_name
    from atlas.trail_bindings b
    join atlas.trail_profiles tp on tp.id = b.profile_id
    left join atlas.trail_profile_nodes n
      on n.profile_id = b.profile_id
     and n.node_key = b.current_node_key
    left join atlas.projects p
      on b.subject_kind = 'project'
     and p.id = b.subject_id
    left join atlas.farms f on f.id = b.farm_id
    join atlas.organizations o on o.id = b.organization_id
    where b.status in ('active','paused')
      and (p_organization_id is null or b.organization_id = p_organization_id)
      and atlas.can_read_trail_binding_v1(b.id)
  ), packed as (
    select
      v.*,
      current_release.task_id,
      current_release.task_title,
      current_release.task_status,
      current_release.task_due_date,
      coalesce(release_count.active_release_count, 0) as active_release_count,
      next_node.node_key as next_node_key,
      next_node.label as next_node_label,
      coalesce(pending.pending_count, 0) as pending_evidence_count,
      case
        when current_release.task_status = 'blocked' then 'blocked'
        when current_release.task_id is null then 'missing_release'
        when v.node_kind in ('review','decision') then 'review'
        when coalesce(release_count.active_release_count, 0) > 1
          or coalesce(pending.pending_count, 0) > 0 then 'waiting'
        else 'moving'
      end as pulse_state
    from visible v
    left join lateral (
      select
        r.task_id,
        t.title as task_title,
        t.status as task_status,
        t.due_date as task_due_date
      from atlas.trail_task_releases r
      join atlas.tasks t on t.id = r.task_id
      where r.trail_binding_id = v.binding_id
        and r.node_key = v.current_node_key
        and r.release_status = 'active'
        and r.release_role = 'current'
      order by r.released_at, r.created_at
      limit 1
    ) current_release on true
    left join lateral (
      select count(*)::integer as active_release_count
      from atlas.trail_task_releases r
      where r.trail_binding_id = v.binding_id
        and r.node_key = v.current_node_key
        and r.release_status = 'active'
    ) release_count on true
    left join lateral (
      select n.node_key, n.label
      from atlas.trail_bindings b
      join atlas.trail_profile_nodes current_node
        on current_node.profile_id = b.profile_id
       and current_node.node_key = b.current_node_key
      join atlas.trail_profile_nodes n
        on n.profile_id = b.profile_id
       and n.node_order > current_node.node_order
      where b.id = v.binding_id
      order by n.node_order
      limit 1
    ) next_node on true
    left join lateral (
      select count(*)::integer as pending_count
      from atlas.trail_evidence_links e
      where e.trail_binding_id = v.binding_id
        and e.evidence_status = 'pending'
    ) pending on true
  )
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'trailId', binding_id,
    'subjectKind', subject_kind,
    'subjectId', subject_id,
    'subjectLabel', coalesce(project_title, current_node_label, profile_label),
    'scopeLabel', coalesce(farm_name, organization_name, 'Atlas'),
    'profileKey', profile_key,
    'profileLabel', profile_label,
    'currentNodeKey', current_node_key,
    'currentNodeLabel', current_node_label,
    'nextNodeKey', next_node_key,
    'nextNodeLabel', next_node_label,
    'state', pulse_state,
    'taskId', task_id,
    'taskTitle', task_title,
    'taskStatus', task_status,
    'dueDate', task_due_date,
    'activeReleaseCount', active_release_count,
    'pendingEvidenceCount', pending_evidence_count,
    'href', case
      when task_id is not null then '/task-focus/' || task_id::text || '?returnTo=%2F'
      when subject_kind = 'project' then '/project/' || subject_id::text
      else '/'
    end
  )) order by
    case pulse_state
      when 'blocked' then 0
      when 'missing_release' then 1
      when 'review' then 2
      when 'waiting' then 3
      else 4
    end,
    task_due_date nulls last,
    coalesce(project_title, current_node_label, profile_label)), '[]'::jsonb)
  from packed;
$$;

grant execute on function atlas.universal_trail_pulse_v1(uuid) to authenticated;
revoke all on function atlas.universal_trail_pulse_v1(uuid) from anon;
