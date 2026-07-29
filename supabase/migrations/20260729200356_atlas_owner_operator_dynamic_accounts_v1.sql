create or replace function atlas.owner_operator_accounts_v1(
  p_effective_account_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_actor_user_id uuid := auth.uid();
  v_effective_user_id uuid;
  v_actor_name text;
  v_effective_name text;
  v_options jsonb := '[]'::jsonb;
  v_farm_membership record;
  v_organization_membership record;
  v_actor_membership_id uuid;
  v_actor_role text;
begin
  if v_actor_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if not exists (
    select 1 from atlas.farm_memberships fm
    where fm.user_id = v_actor_user_id and fm.active = true and fm.role = 'owner'
  ) and not exists (
    select 1 from atlas.organization_memberships om
    where om.user_id = v_actor_user_id and om.active = true and om.role = 'owner'
  ) then
    raise exception 'Owner membership required for operator mode.' using errcode = '42501';
  end if;

  if p_effective_account_id is null or p_effective_account_id = v_actor_user_id then
    v_effective_user_id := v_actor_user_id;
  else
    select candidate.user_id
    into v_effective_user_id
    from (
      select fm.user_id, fm.id as membership_id
      from atlas.farm_memberships fm
      where fm.active = true
        and exists (
          select 1 from atlas.farm_memberships actor_membership
          where actor_membership.user_id = v_actor_user_id
            and actor_membership.active = true
            and actor_membership.role = 'owner'
            and actor_membership.farm_id = fm.farm_id
        )
      union all
      select om.user_id, om.id as membership_id
      from atlas.organization_memberships om
      where om.active = true
        and exists (
          select 1 from atlas.organization_memberships actor_membership
          where actor_membership.user_id = v_actor_user_id
            and actor_membership.active = true
            and actor_membership.role = 'owner'
            and actor_membership.organization_id = om.organization_id
        )
    ) candidate
    where candidate.user_id = p_effective_account_id
       or candidate.membership_id = p_effective_account_id
    order by case when candidate.user_id = p_effective_account_id then 0 else 1 end
    limit 1;
  end if;

  if v_effective_user_id is null then
    raise exception 'The requested Atlas account is not available to this owner.' using errcode = '42501';
  end if;

  select coalesce(up.display_name, split_part(au.email, '@', 1), 'Owner')
  into v_actor_name
  from auth.users au
  left join atlas.user_profiles up on up.user_id = au.id
  where au.id = v_actor_user_id;

  select coalesce(up.display_name, split_part(au.email, '@', 1), 'Atlas member')
  into v_effective_name
  from auth.users au
  left join atlas.user_profiles up on up.user_id = au.id
  where au.id = v_effective_user_id;

  select fm.id, fm.farm_id, f.stable_key as farm_key, f.name as farm_name,
         fm.role, fm.worker_key, coalesce(fm.permissions, '{}'::jsonb) as permissions
  into v_farm_membership
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where fm.user_id = v_effective_user_id
    and fm.active = true
    and f.status = 'active'
    and exists (
      select 1 from atlas.farm_memberships actor_membership
      where actor_membership.user_id = v_actor_user_id
        and actor_membership.active = true
        and actor_membership.role = 'owner'
        and actor_membership.farm_id = fm.farm_id
    )
  order by case fm.role when 'owner' then 0 when 'manager' then 1 else 2 end, f.name, fm.created_at
  limit 1;

  select om.id, om.organization_id, o.stable_key as organization_key, o.name as organization_name,
         om.role, coalesce(om.permissions, '{}'::jsonb) as permissions
  into v_organization_membership
  from atlas.organization_memberships om
  join atlas.organizations o on o.id = om.organization_id
  where om.user_id = v_effective_user_id
    and om.active = true
    and o.status = 'active'
    and exists (
      select 1 from atlas.organization_memberships actor_membership
      where actor_membership.user_id = v_actor_user_id
        and actor_membership.active = true
        and actor_membership.role = 'owner'
        and actor_membership.organization_id = om.organization_id
    )
  order by case om.role when 'owner' then 0 when 'consultant' then 1 else 2 end, o.name, om.created_at
  limit 1;

  select membership_id, role
  into v_actor_membership_id, v_actor_role
  from (
    select fm.id as membership_id, fm.role, 0 as sort_order
    from atlas.farm_memberships fm
    where fm.user_id = v_actor_user_id and fm.active = true and fm.role = 'owner'
    union all
    select om.id, om.role, 1
    from atlas.organization_memberships om
    where om.user_id = v_actor_user_id and om.active = true and om.role = 'owner'
  ) actor_memberships
  order by sort_order
  limit 1;

  with controlled_accounts as (
    select fm.user_id
    from atlas.farm_memberships fm
    where fm.active = true
      and exists (
        select 1 from atlas.farm_memberships actor_membership
        where actor_membership.user_id = v_actor_user_id
          and actor_membership.active = true
          and actor_membership.role = 'owner'
          and actor_membership.farm_id = fm.farm_id
      )
    union
    select om.user_id
    from atlas.organization_memberships om
    where om.active = true
      and exists (
        select 1 from atlas.organization_memberships actor_membership
        where actor_membership.user_id = v_actor_user_id
          and actor_membership.active = true
          and actor_membership.role = 'owner'
          and actor_membership.organization_id = om.organization_id
      )
  ), account_rows as (
    select ca.user_id,
      coalesce(up.display_name, split_part(au.email, '@', 1), 'Atlas member') as display_name,
      (
        select fm.id from atlas.farm_memberships fm
        where fm.user_id = ca.user_id and fm.active = true
          and exists (
            select 1 from atlas.farm_memberships actor_membership
            where actor_membership.user_id = v_actor_user_id
              and actor_membership.active = true
              and actor_membership.role = 'owner'
              and actor_membership.farm_id = fm.farm_id
          )
        order by case fm.role when 'owner' then 0 when 'manager' then 1 else 2 end, fm.created_at
        limit 1
      ) as farm_membership_id,
      (
        select om.id from atlas.organization_memberships om
        where om.user_id = ca.user_id and om.active = true
          and exists (
            select 1 from atlas.organization_memberships actor_membership
            where actor_membership.user_id = v_actor_user_id
              and actor_membership.active = true
              and actor_membership.role = 'owner'
              and actor_membership.organization_id = om.organization_id
          )
        order by case om.role when 'owner' then 0 when 'consultant' then 1 else 2 end, om.created_at
        limit 1
      ) as organization_membership_id
    from controlled_accounts ca
    left join atlas.user_profiles up on up.user_id = ca.user_id
    left join auth.users au on au.id = ca.user_id
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'accountId', ar.user_id,
    'membershipId', coalesce(ar.farm_membership_id, ar.organization_membership_id),
    'farmMembershipId', ar.farm_membership_id,
    'organizationMembershipId', ar.organization_membership_id,
    'displayName', ar.display_name,
    'scopeKind', case
      when ar.farm_membership_id is not null and ar.organization_membership_id is not null then 'universal'
      when ar.farm_membership_id is not null then 'farm'
      else 'organization'
    end,
    'isActor', ar.user_id = v_actor_user_id
  ) order by case when ar.user_id = v_actor_user_id then 0 else 1 end, ar.display_name), '[]'::jsonb)
  into v_options
  from account_rows ar;

  return jsonb_build_object(
    'available', true,
    'isOperating', v_effective_user_id <> v_actor_user_id,
    'actor', jsonb_build_object(
      'accountId', v_actor_user_id,
      'userId', v_actor_user_id,
      'membershipId', v_actor_membership_id,
      'role', v_actor_role,
      'displayName', v_actor_name
    ),
    'effective', jsonb_strip_nulls(jsonb_build_object(
      'accountId', v_effective_user_id,
      'userId', v_effective_user_id,
      'membershipId', coalesce(v_farm_membership.id, v_organization_membership.id),
      'farmMembershipId', v_farm_membership.id,
      'farmId', v_farm_membership.farm_id,
      'farmKey', v_farm_membership.farm_key,
      'farmName', v_farm_membership.farm_name,
      'role', coalesce(v_farm_membership.role, v_organization_membership.role),
      'farmRole', v_farm_membership.role,
      'workerKey', v_farm_membership.worker_key,
      'permissions', coalesce(v_farm_membership.permissions, v_organization_membership.permissions, '{}'::jsonb),
      'organizationMembershipId', v_organization_membership.id,
      'organizationId', v_organization_membership.organization_id,
      'organizationKey', v_organization_membership.organization_key,
      'organizationName', v_organization_membership.organization_name,
      'organizationRole', v_organization_membership.role,
      'displayName', v_effective_name,
      'scopeKind', case
        when v_farm_membership.id is not null and v_organization_membership.id is not null then 'universal'
        when v_farm_membership.id is not null then 'farm'
        else 'organization'
      end
    )),
    'options', v_options
  );
end;
$function$;

create or replace function atlas.owner_operator_project_access_v1(
  p_effective_account_id uuid,
  p_project_id uuid,
  p_capability text default 'read'
)
returns boolean
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_organization_id uuid;
  v_role text;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;

  select p.organization_id into v_organization_id
  from atlas.projects p where p.id = p_project_id and p.status <> 'archived';
  if v_organization_id is null then return false; end if;

  select om.role into v_role
  from atlas.organization_memberships om
  where om.user_id = v_user_id
    and om.organization_id = v_organization_id
    and om.active = true
  limit 1;
  if v_role is null then return false; end if;
  if v_role = 'owner' then return true; end if;

  return exists (
    select 1 from atlas.project_contributors pc
    where pc.project_id = p_project_id
      and pc.user_id = v_user_id
      and pc.active = true
      and case p_capability
        when 'create' then pc.can_create_tasks
        when 'complete' then pc.can_complete_tasks
        when 'submit' then pc.can_submit_results
        else true
      end
  );
end;
$function$;

create or replace function atlas.owner_operator_project_card_v1(
  p_effective_account_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_result jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;
  if not atlas.owner_operator_project_access_v1(p_effective_account_id, p_project_id, 'read') then
    raise exception 'Project access is not active in the selected account.' using errcode = '42501';
  end if;

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
    'myRole', coalesce((
      select case when om.role = 'owner' then 'owner' else pc.contribution_role end
      from atlas.organization_memberships om
      left join atlas.project_contributors pc on pc.project_id = p.id and pc.user_id = v_user_id and pc.active = true
      where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true
      limit 1
    ), 'member'),
    'canCreateTasks', atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'create'),
    'openTaskCount', (
      select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id and t.status in ('open','blocked')
    ),
    'blockedTaskCount', (
      select count(*) from atlas.project_task_links ptl join atlas.tasks t on t.id = ptl.task_id
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
  ) into v_result
  from atlas.projects p
  left join atlas.farms f on f.id = p.farm_id
  where p.id = p_project_id;

  return v_result;
end;
$function$;

create or replace function atlas.owner_operator_organization_home_v1(
  p_effective_account_id uuid,
  p_organization_id uuid default null,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_organization_id uuid;
  v_role text;
  v_home jsonb;
  v_project_tasks jsonb := '[]'::jsonb;
begin
  if p_due_through < p_done_date then
    raise exception 'The universal home window cannot end before its done date.' using errcode = '22023';
  end if;

  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;

  select om.organization_id, om.role
  into v_organization_id, v_role
  from atlas.organization_memberships om
  where om.user_id = v_user_id
    and om.active = true
    and (p_organization_id is null or om.organization_id = p_organization_id)
    and exists (
      select 1 from atlas.organization_memberships actor_membership
      where actor_membership.user_id = auth.uid()
        and actor_membership.active = true
        and actor_membership.role = 'owner'
        and actor_membership.organization_id = om.organization_id
    )
  order by case when om.organization_id = p_organization_id then 0 else 1 end,
           case when om.role = 'owner' then 0 when om.role = 'consultant' then 1 else 2 end,
           om.created_at
  limit 1;

  if v_organization_id is null then
    raise exception 'The selected account has no available organization membership.' using errcode = '42501';
  end if;

  with visible_projects as (
    select p.* from atlas.projects p
    where p.organization_id = v_organization_id
      and p.status <> 'archived'
      and atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'read')
  )
  select jsonb_build_object(
    'organization', jsonb_build_object(
      'organizationId', o.id,
      'organizationKey', o.stable_key,
      'name', o.name
    ),
    'viewer', jsonb_build_object('role', v_role, 'isOwner', v_role = 'owner'),
    'workstreams', coalesce((select jsonb_agg(workstream order by workstream) from (select distinct workstream from visible_projects) ws), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(item order by sort_date nulls last, title)
      from (
        select jsonb_build_object(
          'attentionId', pai.id, 'kind', pai.attention_type, 'title', pai.title,
          'detail', pai.detail, 'dueDate', pai.due_date, 'projectId', vp.id,
          'projectTitle', vp.title, 'farmName', f.name
        ) as item, pai.due_date as sort_date, pai.title
        from visible_projects vp
        join atlas.project_attention_items pai on pai.project_id = vp.id and pai.status = 'open'
        left join atlas.farms f on f.id = vp.farm_id
        union all
        select jsonb_build_object(
          'attentionId', null, 'kind', 'blocked', 'title', t.title,
          'detail', coalesce(t.blocker_text, 'This project task is blocked.'), 'dueDate', t.due_date,
          'projectId', vp.id, 'projectTitle', vp.title, 'farmName', f.name
        ), t.due_date, t.title
        from visible_projects vp
        join atlas.project_task_links ptl on ptl.project_id = vp.id
        join atlas.tasks t on t.id = ptl.task_id and t.status = 'blocked'
        left join atlas.farms f on f.id = vp.farm_id
        union all
        select jsonb_build_object(
          'attentionId', null, 'kind', 'deadline_risk', 'title', t.title,
          'detail', 'This project task is past its due date.', 'dueDate', t.due_date,
          'projectId', vp.id, 'projectTitle', vp.title, 'farmName', f.name
        ), t.due_date, t.title
        from visible_projects vp
        join atlas.project_task_links ptl on ptl.project_id = vp.id
        join atlas.tasks t on t.id = ptl.task_id
        left join atlas.farms f on f.id = vp.farm_id
        where t.status = 'open' and t.due_date < current_date
      ) attention_rows
    ), '[]'::jsonb),
    'crossFarmProjects', coalesce((
      select jsonb_agg(atlas.owner_operator_project_card_v1(p_effective_account_id, vp.id) order by vp.sort_order, vp.title)
      from visible_projects vp where vp.farm_id is null
    ), '[]'::jsonb),
    'farms', coalesce((
      select jsonb_agg(jsonb_build_object(
        'farmId', f.id, 'farmKey', f.stable_key, 'farmName', f.name, 'status', f.status,
        'facts', f.metadata,
        'projects', coalesce((
          select jsonb_agg(atlas.owner_operator_project_card_v1(p_effective_account_id, vp.id) order by vp.workstream, vp.sort_order, vp.title)
          from visible_projects vp where vp.farm_id = f.id
        ), '[]'::jsonb)
      ) order by f.name)
      from atlas.farms f
      where f.organization_id = v_organization_id
        and f.status = 'active'
        and (v_role = 'owner' or exists (select 1 from visible_projects vp where vp.farm_id = f.id))
    ), '[]'::jsonb)
  ) into v_home
  from atlas.organizations o where o.id = v_organization_id;

  with visible_projects as (
    select p.* from atlas.projects p
    where p.organization_id = v_organization_id
      and p.status <> 'archived'
      and atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'read')
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id,
    'projectId', vp.id,
    'projectKey', vp.stable_key,
    'projectTitle', vp.title,
    'farmId', vp.farm_id,
    'farmKey', f.stable_key,
    'farmName', f.name,
    'workstream', vp.workstream,
    'title', t.title,
    'status', t.status,
    'priority', t.priority,
    'dueDate', t.due_date,
    'note', t.note,
    'blockerText', t.blocker_text,
    'assignedToViewer', t.assigned_user_id = v_user_id,
    'createdByViewer', t.created_by_user_id = v_user_id,
    'originKind', t.origin_kind,
    'createdAt', t.created_at,
    'updatedAt', t.updated_at,
    'completedAt', t.completed_at
  ) order by case t.status when 'blocked' then 0 when 'open' then 1 else 2 end, t.due_date nulls last, ptl.sort_order, t.created_at), '[]'::jsonb)
  into v_project_tasks
  from visible_projects vp
  join atlas.project_task_links ptl on ptl.project_id = vp.id
  join atlas.tasks t on t.id = ptl.task_id
  left join atlas.farms f on f.id = vp.farm_id
  where t.task_scope = 'project'
    and (t.status in ('open','blocked') or (t.status = 'done' and coalesce(t.completed_at::date, t.updated_at::date) = p_done_date));

  return jsonb_build_object(
    'viewer', jsonb_build_object(
      'userId', v_user_id,
      'organizationId', v_organization_id,
      'organizationRole', v_role,
      'activeFarmId', null,
      'hasOrganizationScope', true,
      'hasFarmScope', false
    ),
    'organizationHome', v_home,
    'projectTasks', v_project_tasks,
    'farms', '[]'::jsonb,
    'window', jsonb_build_object('doneDate', p_done_date, 'dueThrough', p_due_through),
    'operatorContext', v_context
  );
end;
$function$;

create or replace function atlas.owner_operator_project_detail_v1(
  p_effective_account_id uuid,
  p_project_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_result jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;
  if not atlas.owner_operator_project_access_v1(p_effective_account_id, p_project_id, 'read') then
    raise exception 'Project access is not active in the selected account.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'project', atlas.owner_operator_project_card_v1(p_effective_account_id, p.id),
    'permissions', jsonb_build_object(
      'canCreateTasks', atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'create'),
      'isOrganizationOwner', exists (
        select 1 from atlas.organization_memberships om
        where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true and om.role = 'owner'
      )
    ),
    'tasks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority,
        'dueDate', t.due_date, 'note', t.note, 'blockerText', t.blocker_text,
        'assignedToViewer', t.assigned_user_id = v_user_id,
        'createdByViewer', t.created_by_user_id = v_user_id,
        'originKind', t.origin_kind, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
        'completedAt', t.completed_at
      ) order by case when t.status in ('open','blocked') then 0 else 1 end, t.due_date nulls last, ptl.sort_order, t.created_at)
      from atlas.project_task_links ptl join atlas.tasks t on t.id = ptl.task_id
      where ptl.project_id = p.id
    ), '[]'::jsonb),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'stepId', ps.id, 'title', ps.title, 'status', ps.status, 'stepOrder', ps.step_order,
        'linkedTaskId', ps.linked_task_id, 'note', ps.note
      ) order by ps.step_order, ps.created_at)
      from atlas.project_steps ps where ps.project_id = p.id
    ), '[]'::jsonb),
    'attention', coalesce((
      select jsonb_agg(jsonb_build_object(
        'attentionId', pai.id, 'kind', pai.attention_type, 'title', pai.title,
        'detail', pai.detail, 'dueDate', pai.due_date, 'status', pai.status
      ) order by pai.due_date nulls last, pai.created_at)
      from atlas.project_attention_items pai where pai.project_id = p.id and pai.status = 'open'
    ), '[]'::jsonb)
  ) into v_result
  from atlas.projects p where p.id = p_project_id;

  return v_result;
end;
$function$;

create or replace function atlas.owner_operator_project_task_focus_v1(
  p_effective_account_id uuid,
  p_task_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_user_id uuid;
  v_result jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_user_id := (v_context #>> '{effective,userId}')::uuid;

  select jsonb_build_object(
    'organizationName', o.name,
    'project', atlas.owner_operator_project_card_v1(p_effective_account_id, p.id),
    'task', jsonb_build_object(
      'taskId', t.id, 'title', t.title, 'status', t.status, 'priority', t.priority,
      'dueDate', t.due_date, 'note', t.note, 'blockerText', t.blocker_text,
      'assignedToViewer', t.assigned_user_id = v_user_id,
      'createdByViewer', t.created_by_user_id = v_user_id,
      'originKind', t.origin_kind, 'createdAt', t.created_at, 'updatedAt', t.updated_at,
      'completedAt', t.completed_at
    ),
    'step', (
      select jsonb_build_object(
        'stepId', ps.id, 'title', ps.title, 'status', ps.status, 'stepOrder', ps.step_order,
        'linkedTaskId', ps.linked_task_id, 'note', ps.note
      ) from atlas.project_steps ps
      where ps.project_id = p.id and ps.linked_task_id = t.id
      order by ps.step_order limit 1
    ),
    'permissions', jsonb_build_object(
      'canComplete', atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'complete')
        and (t.assigned_user_id = v_user_id or exists (
          select 1 from atlas.organization_memberships om
          where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true and om.role = 'owner'
        )),
      'canEdit', atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'complete')
        and (t.assigned_user_id = v_user_id or exists (
          select 1 from atlas.organization_memberships om
          where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true and om.role = 'owner'
        )),
      'isOrganizationOwner', exists (
        select 1 from atlas.organization_memberships om
        where om.organization_id = p.organization_id and om.user_id = v_user_id and om.active = true and om.role = 'owner'
      )
    )
  ) into v_result
  from atlas.project_task_links ptl
  join atlas.tasks t on t.id = ptl.task_id
  join atlas.projects p on p.id = ptl.project_id
  join atlas.organizations o on o.id = p.organization_id
  where t.id = p_task_id
    and t.task_scope = 'project'
    and atlas.owner_operator_project_access_v1(p_effective_account_id, p.id, 'read')
  order by ptl.created_at
  limit 1;

  return v_result;
end;
$function$;

create or replace function atlas.owner_operator_transition_project_task_v1(
  p_effective_account_id uuid,
  p_task_id uuid,
  p_transition text,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_effective_user_id uuid;
  v_actor_membership_id uuid;
  v_project_id uuid;
  v_organization_id uuid;
  v_assigned_user_id uuid;
  v_effective_owner boolean;
  v_result uuid;
  v_operator_payload jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_effective_user_id := (v_context #>> '{effective,userId}')::uuid;
  v_actor_membership_id := nullif(v_context #>> '{actor,membershipId}', '')::uuid;

  select p.id, p.organization_id, t.assigned_user_id
  into v_project_id, v_organization_id, v_assigned_user_id
  from atlas.project_task_links ptl
  join atlas.projects p on p.id = ptl.project_id
  join atlas.tasks t on t.id = ptl.task_id
  where t.id = p_task_id and t.task_scope = 'project'
  order by ptl.created_at
  limit 1;

  if v_project_id is null then
    raise exception 'Project task not found.' using errcode = 'P0002';
  end if;

  select exists (
    select 1 from atlas.organization_memberships om
    where om.organization_id = v_organization_id and om.user_id = v_effective_user_id
      and om.active = true and om.role = 'owner'
  ) into v_effective_owner;

  if not atlas.owner_operator_project_access_v1(p_effective_account_id, v_project_id, 'complete')
     or (not v_effective_owner and v_assigned_user_id is distinct from v_effective_user_id) then
    raise exception 'This project task is not available in the selected account.' using errcode = '42501';
  end if;

  v_result := atlas.transition_project_task_v1(p_task_id, p_transition, p_note);
  v_operator_payload := jsonb_build_object(
    'operator_mode', true,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_actor_membership_id,
    'actor_role', 'owner',
    'effective_user_id', v_effective_user_id,
    'effective_account_id', v_effective_user_id,
    'effective_display_name', v_context #>> '{effective,displayName}'
  );

  update atlas.tasks
  set metadata = coalesce(metadata, '{}'::jsonb) || v_operator_payload,
      updated_at = now()
  where id = p_task_id;

  update atlas.trail_evidence_links
  set metadata = coalesce(metadata, '{}'::jsonb) || v_operator_payload,
      updated_at = now()
  where source_type = 'project_task' and source_id = p_task_id::text;

  return v_result;
end;
$function$;

create or replace function atlas.owner_operator_create_project_task_v1(
  p_effective_account_id uuid,
  p_project_id uuid,
  p_title text,
  p_due_date date default null,
  p_note text default null
)
returns uuid
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_effective_user_id uuid;
  v_actor_membership_id uuid;
  v_task_id uuid;
  v_operator_payload jsonb;
begin
  v_context := atlas.owner_operator_accounts_v1(p_effective_account_id);
  v_effective_user_id := (v_context #>> '{effective,userId}')::uuid;
  v_actor_membership_id := nullif(v_context #>> '{actor,membershipId}', '')::uuid;

  if not atlas.owner_operator_project_access_v1(p_effective_account_id, p_project_id, 'create') then
    raise exception 'Project contribution access is not active in the selected account.' using errcode = '42501';
  end if;

  v_task_id := atlas.create_project_task_v1(p_project_id, p_title, p_due_date, p_note);
  v_operator_payload := jsonb_build_object(
    'operator_mode', true,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_actor_membership_id,
    'actor_role', 'owner',
    'effective_user_id', v_effective_user_id,
    'effective_account_id', v_effective_user_id,
    'effective_display_name', v_context #>> '{effective,displayName}'
  );

  update atlas.tasks
  set assigned_user_id = v_effective_user_id,
      created_by_user_id = v_effective_user_id,
      metadata = coalesce(metadata, '{}'::jsonb) || v_operator_payload,
      updated_at = now()
  where id = v_task_id;

  return v_task_id;
end;
$function$;

revoke all on function atlas.owner_operator_accounts_v1(uuid) from public;
revoke all on function atlas.owner_operator_accounts_v1(uuid) from anon;
grant execute on function atlas.owner_operator_accounts_v1(uuid) to authenticated;

revoke all on function atlas.owner_operator_project_access_v1(uuid, uuid, text) from public;
revoke all on function atlas.owner_operator_project_access_v1(uuid, uuid, text) from anon;
grant execute on function atlas.owner_operator_project_access_v1(uuid, uuid, text) to authenticated;

revoke all on function atlas.owner_operator_project_card_v1(uuid, uuid) from public;
revoke all on function atlas.owner_operator_project_card_v1(uuid, uuid) from anon;
grant execute on function atlas.owner_operator_project_card_v1(uuid, uuid) to authenticated;

revoke all on function atlas.owner_operator_organization_home_v1(uuid, uuid, date, date) from public;
revoke all on function atlas.owner_operator_organization_home_v1(uuid, uuid, date, date) from anon;
grant execute on function atlas.owner_operator_organization_home_v1(uuid, uuid, date, date) to authenticated;

revoke all on function atlas.owner_operator_project_detail_v1(uuid, uuid) from public;
revoke all on function atlas.owner_operator_project_detail_v1(uuid, uuid) from anon;
grant execute on function atlas.owner_operator_project_detail_v1(uuid, uuid) to authenticated;

revoke all on function atlas.owner_operator_project_task_focus_v1(uuid, uuid) from public;
revoke all on function atlas.owner_operator_project_task_focus_v1(uuid, uuid) from anon;
grant execute on function atlas.owner_operator_project_task_focus_v1(uuid, uuid) to authenticated;

revoke all on function atlas.owner_operator_transition_project_task_v1(uuid, uuid, text, text) from public;
revoke all on function atlas.owner_operator_transition_project_task_v1(uuid, uuid, text, text) from anon;
grant execute on function atlas.owner_operator_transition_project_task_v1(uuid, uuid, text, text) to authenticated;

revoke all on function atlas.owner_operator_create_project_task_v1(uuid, uuid, text, date, text) from public;
revoke all on function atlas.owner_operator_create_project_task_v1(uuid, uuid, text, date, text) from anon;
grant execute on function atlas.owner_operator_create_project_task_v1(uuid, uuid, text, date, text) to authenticated;
