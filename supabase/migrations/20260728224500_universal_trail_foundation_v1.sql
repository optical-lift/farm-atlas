-- Universal Atlas Trail foundation: profiles, bindings, evidence provenance, and project adapter.

create table if not exists atlas.trail_profiles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  stable_key text not null,
  label text not null,
  subject_kind text not null,
  status text not null default 'active' check (status in ('active','archived')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, stable_key)
);

create table if not exists atlas.trail_profile_nodes (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references atlas.trail_profiles(id) on delete cascade,
  node_key text not null,
  label text not null,
  node_order integer not null,
  node_kind text not null default 'milestone' check (node_kind in ('milestone','care_pulse','review','decision','terminal')),
  evidence_rule jsonb not null default '{}'::jsonb,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, node_key),
  unique (profile_id, node_order)
);

create table if not exists atlas.trail_bindings (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references atlas.trail_profiles(id) on delete restrict,
  organization_id uuid not null references atlas.organizations(id) on delete cascade,
  farm_id uuid references atlas.farms(id) on delete cascade,
  subject_kind text not null,
  subject_id uuid not null,
  status text not null default 'active' check (status in ('active','complete','paused','archived')),
  current_node_key text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (subject_kind, subject_id)
);

create table if not exists atlas.trail_evidence_links (
  id uuid primary key default gen_random_uuid(),
  trail_binding_id uuid not null references atlas.trail_bindings(id) on delete cascade,
  node_key text not null,
  source_type text not null,
  source_id text not null,
  evidence_status text not null default 'accepted' check (evidence_status in ('accepted','pending','rejected','retracted')),
  link_method text not null default 'direct' check (link_method in ('direct','strong','confirmed','manual')),
  confidence numeric(4,3) not null default 1 check (confidence >= 0 and confidence <= 1),
  occurred_at timestamptz not null default now(),
  confirmed_by_user_id uuid references auth.users(id) on delete set null,
  confirmed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trail_binding_id, node_key, source_type, source_id)
);

create index if not exists trail_profiles_scope_idx on atlas.trail_profiles(organization_id, status, subject_kind);
create index if not exists trail_profile_nodes_order_idx on atlas.trail_profile_nodes(profile_id, node_order);
create index if not exists trail_bindings_scope_idx on atlas.trail_bindings(organization_id, farm_id, subject_kind, status);
create index if not exists trail_evidence_node_idx on atlas.trail_evidence_links(trail_binding_id, node_key, evidence_status, occurred_at desc);

create or replace function atlas.can_read_trail_binding_v1(p_binding_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $$
  select exists (
    select 1
    from atlas.trail_bindings b
    where b.id = p_binding_id
      and (
        atlas.is_organization_owner(b.organization_id)
        or (b.farm_id is not null and atlas.current_farm_role(b.farm_id) is not null)
        or (b.subject_kind = 'project' and atlas.can_read_project(b.subject_id))
      )
  );
$$;

grant execute on function atlas.can_read_trail_binding_v1(uuid) to authenticated;

alter table atlas.trail_profiles enable row level security;
alter table atlas.trail_profile_nodes enable row level security;
alter table atlas.trail_bindings enable row level security;
alter table atlas.trail_evidence_links enable row level security;

drop policy if exists trail_profiles_read_visible on atlas.trail_profiles;
create policy trail_profiles_read_visible on atlas.trail_profiles
for select to authenticated
using (exists (
  select 1 from atlas.trail_bindings b
  where b.profile_id = trail_profiles.id
    and atlas.can_read_trail_binding_v1(b.id)
));

drop policy if exists trail_profile_nodes_read_visible on atlas.trail_profile_nodes;
create policy trail_profile_nodes_read_visible on atlas.trail_profile_nodes
for select to authenticated
using (exists (
  select 1 from atlas.trail_bindings b
  where b.profile_id = trail_profile_nodes.profile_id
    and atlas.can_read_trail_binding_v1(b.id)
));

drop policy if exists trail_bindings_read_visible on atlas.trail_bindings;
create policy trail_bindings_read_visible on atlas.trail_bindings
for select to authenticated
using (atlas.can_read_trail_binding_v1(id));

drop policy if exists trail_evidence_links_read_visible on atlas.trail_evidence_links;
create policy trail_evidence_links_read_visible on atlas.trail_evidence_links
for select to authenticated
using (atlas.can_read_trail_binding_v1(trail_binding_id));

grant select on atlas.trail_profiles, atlas.trail_profile_nodes, atlas.trail_bindings, atlas.trail_evidence_links to authenticated;

insert into atlas.trail_profiles (organization_id, stable_key, label, subject_kind, status, metadata)
select o.id, seed.stable_key, seed.label, 'project', 'active', seed.metadata
from atlas.organizations o
cross join (values
  ('project_delivery', 'Project delivery', jsonb_build_object('family','project_delivery')),
  ('room_readiness', 'Room readiness', jsonb_build_object('family','room_readiness')),
  ('research_decision', 'Research and decision', jsonb_build_object('family','research_decision'))
) as seed(stable_key, label, metadata)
where o.stable_key = 'feast_guild'
on conflict (organization_id, stable_key) do update
set label = excluded.label,
    subject_kind = excluded.subject_kind,
    status = 'active',
    metadata = atlas.trail_profiles.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.trail_profile_nodes (profile_id, node_key, label, node_order, node_kind, evidence_rule, metadata)
select tp.id, seed.node_key, seed.label, seed.node_order, seed.node_kind,
       jsonb_build_object('requires_accepted_evidence', true),
       jsonb_build_object('seed','universal_trail_foundation_v1')
from atlas.trail_profiles tp
join atlas.organizations o on o.id = tp.organization_id and o.stable_key = 'feast_guild'
join (values
  ('project_delivery','define_outcome','Define outcome',10,'milestone'),
  ('project_delivery','gather_inputs','Gather inputs',20,'milestone'),
  ('project_delivery','draft','Draft',30,'milestone'),
  ('project_delivery','review','Review',40,'review'),
  ('project_delivery','finalize','Finalize',50,'milestone'),
  ('project_delivery','verify','Verify',60,'terminal'),
  ('room_readiness','define','Define room',10,'milestone'),
  ('room_readiness','clear','Clear room',20,'milestone'),
  ('room_readiness','repair','Repair',30,'milestone'),
  ('room_readiness','furnish','Furnish',40,'milestone'),
  ('room_readiness','safety_review','Safety review',50,'review'),
  ('room_readiness','ready','Ready',60,'terminal'),
  ('research_decision','frame_question','Frame question',10,'milestone'),
  ('research_decision','identify_pathways','Identify pathways',20,'milestone'),
  ('research_decision','verify','Verify programs',30,'milestone'),
  ('research_decision','compare','Compare applicability',40,'milestone'),
  ('research_decision','recommend','Recommend next actions',50,'review'),
  ('research_decision','decide','Decide',60,'decision')
) as seed(profile_key,node_key,label,node_order,node_kind)
  on seed.profile_key = tp.stable_key
on conflict (profile_id, node_key) do update
set label = excluded.label,
    node_order = excluded.node_order,
    node_kind = excluded.node_kind,
    evidence_rule = excluded.evidence_rule,
    metadata = atlas.trail_profile_nodes.metadata || excluded.metadata,
    updated_at = now();

insert into atlas.trail_bindings (
  profile_id, organization_id, farm_id, subject_kind, subject_id, status, current_node_key, metadata
)
select tp.id, p.organization_id, p.farm_id, 'project', p.id, 'active',
       case p.stable_key
         when 'elm_airbnb_launch' then 'draft'
         when 'waiting_room_ada_compliant_ward' then 'repair'
         when 'rehabilitation_house_funding_caregiver_pathways' then 'frame_question'
       end,
       jsonb_build_object('source','project_profile_seed','project_key',p.stable_key)
from atlas.projects p
join atlas.trail_profiles tp
  on tp.organization_id = p.organization_id
 and tp.stable_key = case p.stable_key
   when 'elm_airbnb_launch' then 'project_delivery'
   when 'waiting_room_ada_compliant_ward' then 'room_readiness'
   when 'rehabilitation_house_funding_caregiver_pathways' then 'research_decision'
 end
where p.stable_key in (
  'elm_airbnb_launch',
  'waiting_room_ada_compliant_ward',
  'rehabilitation_house_funding_caregiver_pathways'
)
on conflict (subject_kind, subject_id) do update
set profile_id = excluded.profile_id,
    organization_id = excluded.organization_id,
    farm_id = excluded.farm_id,
    status = 'active',
    current_node_key = coalesce(atlas.trail_bindings.current_node_key, excluded.current_node_key),
    metadata = atlas.trail_bindings.metadata || excluded.metadata,
    updated_at = now();

update atlas.project_steps ps
set step_order = 30,
    metadata = coalesce(ps.metadata, '{}'::jsonb) || jsonb_build_object('trail_node_key','draft','trail_profile_key','project_delivery'),
    updated_at = now()
from atlas.projects p
where p.id = ps.project_id
  and p.stable_key = 'elm_airbnb_launch'
  and ps.linked_task_id is not null;

update atlas.project_steps ps
set step_order = 10,
    metadata = coalesce(ps.metadata, '{}'::jsonb) || jsonb_build_object('trail_node_key','frame_question','trail_profile_key','research_decision'),
    updated_at = now()
from atlas.projects p
where p.id = ps.project_id
  and p.stable_key = 'rehabilitation_house_funding_caregiver_pathways'
  and ps.linked_task_id is not null;

insert into atlas.project_steps (project_id, title, step_order, status, metadata)
select b.subject_id, n.label, n.node_order, 'open',
       jsonb_build_object('trail_node_key',n.node_key,'trail_profile_key',p.stable_key,'source','trail_profile_projection')
from atlas.trail_bindings b
join atlas.trail_profiles p on p.id = b.profile_id
join atlas.trail_profile_nodes n on n.profile_id = p.id
where b.subject_kind = 'project'
  and b.status <> 'archived'
  and not exists (
    select 1
    from atlas.project_steps ps
    where ps.project_id = b.subject_id
      and (
        ps.metadata ->> 'trail_node_key' = n.node_key
        or ps.step_order = n.node_order
      )
  );

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
      ps.id as project_step_id,
      ps.status as project_step_status,
      ps.linked_task_id,
      ps.note as project_step_note,
      t.title as task_title,
      t.status as task_status,
      t.due_date as task_due_date,
      coalesce(ev.accepted_count, 0) as accepted_count,
      ev.last_evidence_at
    from binding b
    join atlas.trail_profile_nodes n on n.profile_id = b.profile_id
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
    ) ps on true
    left join atlas.tasks t on t.id = ps.linked_task_id
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
        when ns.accepted_count > 0 then 'complete'
        when ns.node_key = ns.current_node_key and (ns.project_step_status = 'blocked' or ns.task_status = 'blocked') then 'blocked'
        when ns.node_key = ns.current_node_key then 'current'
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
        'taskId', case when r.resolved_status in ('current','blocked') then r.linked_task_id else null end,
        'evidenceCount', r.accepted_count,
        'note', case when r.resolved_status in ('current','blocked') then r.project_step_note else null end
      )) order by r.node_order)
      from resolved r
    ), '[]'::jsonb),
    'currentNodeId', (select node_id from current_row),
    'currentMove', (select case when linked_task_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'kind','project_task',
      'taskId',linked_task_id,
      'title',coalesce(task_title,label),
      'status',coalesce(task_status,project_step_status),
      'dueDate',task_due_date,
      'href','/project/' || p_project_id::text || '#project-work'
    )) end from current_row),
    'nextNode', (select jsonb_build_object('nodeId',node_id,'nodeKey',node_key,'label',label,'status',resolved_status,'nodeKind',node_kind) from next_row),
    'blocker', coalesce(
      (select case when resolved_status = 'blocked' then jsonb_build_object(
        'kind','blocked_move','title',coalesce(task_title,label),'detail',coalesce(project_step_note,'The current move is blocked.')
      ) else null end from current_row),
      (select jsonb_build_object('kind',pai.attention_type,'title',pai.title,'detail',pai.detail,'dueDate',pai.due_date)
       from atlas.project_attention_items pai
       where pai.project_id = p_project_id and pai.status = 'open'
         and pai.attention_type in ('blocked','decision','review','missing_information','external_dependency')
       order by pai.due_date nulls last, pai.created_at
       limit 1)
    ),
    'unresolvedEvidenceCount',
      (select count(*)::integer from resolved where resolved_status = 'unresolved')
      + (select count(*)::integer from atlas.trail_evidence_links e where e.trail_binding_id = b.id and e.evidence_status = 'pending'),
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

create or replace function atlas.trail_context_v1(p_subject_kind text, p_subject_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
begin
  if p_subject_kind = 'project' then
    return atlas.project_trail_context_v2(p_subject_id);
  end if;
  return null;
end;
$$;

grant execute on function atlas.trail_context_v1(text, uuid) to authenticated;

create or replace function atlas.task_trail_context_v2(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_project_id uuid;
begin
  select ptl.project_id into v_project_id
  from atlas.project_task_links ptl
  where ptl.task_id = p_task_id
    and atlas.can_read_project(ptl.project_id)
  order by ptl.created_at
  limit 1;

  if v_project_id is not null then
    return atlas.project_trail_context_v2(v_project_id);
  end if;

  return null;
end;
$$;

grant execute on function atlas.task_trail_context_v2(uuid) to authenticated;

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
      where pc.project_id = p.id and pc.user_id = auth.uid() and pc.active = true
      limit 1
    ),
    'canCreateTasks', atlas.can_contribute_to_project(p.id),
    'openTaskCount', (
      select count(*) from atlas.project_task_links ptl
      join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id and t.status in ('open','blocked')
    ),
    'blockedTaskCount', (
      select count(*) from atlas.project_task_links ptl
      join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id and t.status = 'blocked'
    ),
    'openAttentionCount', (
      select count(*) from atlas.project_attention_items pai
      where pai.project_id = p.id and pai.status = 'open'
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
    ), '[]'::jsonb),
    'trail', atlas.project_trail_context_v2(p.id)
  )
  from atlas.projects p
  left join atlas.farms f on f.id = p.farm_id
  where p.id = p_project_id;
$$;

grant execute on function atlas.portfolio_project_card_v1(uuid) to authenticated;

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
  v_step_id uuid;
  v_binding_id uuid;
  v_node_key text;
  v_next_node_key text;
  v_next_node_label text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
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

  select p.organization_id into v_organization_id from atlas.projects p where p.id = v_project_id;
  if v_task.assigned_user_id is distinct from auth.uid()
     and not atlas.is_organization_owner(v_organization_id) then
    raise exception 'This project task is not assigned to the signed-in user.' using errcode = '42501';
  end if;

  update atlas.tasks
  set status = 'done',
      completed_at = coalesce(completed_at, now()),
      note = coalesce(nullif(btrim(p_note), ''), note),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'project_completed_at', now(),
        'project_completion_source', 'portfolio'
      ),
      updated_at = now()
  where id = p_task_id;

  update atlas.project_steps
  set status = 'done', completed_at = coalesce(completed_at, now()), updated_at = now()
  where linked_task_id = p_task_id
  returning id into v_step_id;

  select b.id into v_binding_id
  from atlas.trail_bindings b
  where b.subject_kind = 'project' and b.subject_id = v_project_id and b.status <> 'archived'
  limit 1;

  if v_binding_id is not null and v_step_id is not null then
    select coalesce(ps.metadata ->> 'trail_node_key', n.node_key)
    into v_node_key
    from atlas.project_steps ps
    join atlas.trail_bindings b on b.id = v_binding_id
    left join atlas.trail_profile_nodes n on n.profile_id = b.profile_id and n.node_order = ps.step_order
    where ps.id = v_step_id;

    if v_node_key is not null then
      insert into atlas.trail_evidence_links (
        trail_binding_id, node_key, source_type, source_id, evidence_status,
        link_method, confidence, occurred_at, confirmed_by_user_id, confirmed_at, metadata
      ) values (
        v_binding_id, v_node_key, 'project_task', p_task_id::text, 'accepted',
        'direct', 1, now(), auth.uid(), now(),
        jsonb_build_object('project_id',v_project_id,'project_step_id',v_step_id,'completion_source','complete_project_task_v1')
      )
      on conflict (trail_binding_id, node_key, source_type, source_id) do update
      set evidence_status = 'accepted',
          occurred_at = excluded.occurred_at,
          confirmed_by_user_id = excluded.confirmed_by_user_id,
          confirmed_at = excluded.confirmed_at,
          metadata = atlas.trail_evidence_links.metadata || excluded.metadata,
          updated_at = now();

      select n.node_key, n.label
      into v_next_node_key, v_next_node_label
      from atlas.trail_bindings b
      join atlas.trail_profile_nodes current_node on current_node.profile_id = b.profile_id and current_node.node_key = v_node_key
      join atlas.trail_profile_nodes n on n.profile_id = b.profile_id and n.node_order > current_node.node_order
      where b.id = v_binding_id
      order by n.node_order
      limit 1;

      update atlas.trail_bindings
      set current_node_key = v_next_node_key,
          status = case when v_next_node_key is null then 'complete' else status end,
          updated_at = now()
      where id = v_binding_id
        and current_node_key = v_node_key;
    end if;
  end if;

  update atlas.projects
  set last_movement_at = now(),
      current_milestone = coalesce(v_next_node_label, current_milestone),
      health_status = case when v_binding_id is not null and v_next_node_key is null then 'complete' else health_status end,
      updated_at = now()
  where id = v_project_id;

  return p_task_id;
end;
$$;

grant execute on function atlas.complete_project_task_v1(uuid, text) to authenticated;