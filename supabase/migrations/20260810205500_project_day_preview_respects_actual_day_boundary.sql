create or replace function atlas.project_task_visible_on_day_v1(
  p_status text,
  p_due_date date,
  p_completed_at timestamptz,
  p_updated_at timestamptz,
  p_metadata jsonb,
  p_selected_date date
)
returns boolean
language sql
stable
set search_path to 'pg_catalog', 'atlas'
as $$
  select case
    when p_status = 'done' then
      coalesce(coalesce(p_completed_at::date, p_updated_at::date) = p_selected_date, false)
    when p_status not in ('open', 'blocked') then false
    when p_selected_date <> (now() at time zone 'America/Chicago')::date then
      coalesce(p_due_date = p_selected_date, false)
    else
      (
        coalesce(p_due_date <= p_selected_date, false)
        or lower(coalesce(p_metadata ->> 'current_serving', 'false')) = 'true'
        or lower(coalesce(p_metadata ->> 'completion_gate_serving', 'false')) = 'true'
        or (
          coalesce(p_metadata ->> 'release_queue_state', '') = 'active'
          and coalesce(p_metadata ->> 'calendar_semantics', '') = 'current_serving_not_backlog_debt'
        )
      )
  end;
$$;

comment on function atlas.project_task_visible_on_day_v1(text,date,timestamptz,timestamptz,jsonb,date) is
'Project-task day boundary: today may include true overdue/current-serving work; future and historical previews show only work actually due on that selected date. Prevents unfinished current-day work from traveling forward before the day ends.';

create or replace function atlas.owner_operator_organization_home_v1(
  p_effective_account_id uuid,
  p_organization_id uuid default null::uuid,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language plpgsql
stable security definer
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
    and lower(coalesce(t.metadata ->> 'project_tracking_only', 'false')) <> 'true'
    and atlas.project_task_visible_on_day_v1(
      t.status, t.due_date, t.completed_at, t.updated_at, t.metadata, p_done_date
    );

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

create or replace function atlas.universal_home_v1(
  p_organization_id uuid default null::uuid,
  p_preferred_farm_id uuid default null::uuid,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_organization_id uuid;
  v_organization_role text;
  v_organization_home jsonb := null;
  v_project_tasks jsonb := '[]'::jsonb;
  v_active_farm_id uuid;
  v_farms jsonb := '[]'::jsonb;
  v_farm record;
  v_snapshot jsonb;
  v_task_cards jsonb;
  v_open_count integer;
  v_blocked_count integer;
  v_overdue_count integer;
  v_due_today_count integer;
  v_last_movement_at timestamptz;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if p_due_through < p_done_date then
    raise exception 'The universal home window cannot end before its done date.' using errcode = '22023';
  end if;

  select om.organization_id, om.role
  into v_organization_id, v_organization_role
  from atlas.organization_memberships om
  where om.user_id = v_user_id
    and om.active = true
    and (p_organization_id is null or om.organization_id = p_organization_id)
  order by
    case when om.organization_id = p_organization_id then 0 else 1 end,
    case when om.role = 'owner' then 0 when om.role = 'consultant' then 1 else 2 end,
    om.created_at
  limit 1;

  if v_organization_id is not null then
    v_organization_home := atlas.portfolio_home_v1(v_organization_id);

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'taskId', visible.task_id,
          'projectId', visible.project_id,
          'projectKey', visible.project_key,
          'projectTitle', visible.project_title,
          'farmId', visible.farm_id,
          'farmKey', visible.farm_key,
          'farmName', visible.farm_name,
          'workstream', visible.workstream,
          'title', visible.task_title,
          'status', visible.task_status,
          'priority', visible.priority,
          'dueDate', visible.due_date,
          'note', visible.note,
          'blockerText', visible.blocker_text,
          'assignedToViewer', visible.assigned_user_id = v_user_id,
          'createdByViewer', visible.created_by_user_id = v_user_id,
          'originKind', visible.origin_kind,
          'createdAt', visible.created_at,
          'updatedAt', visible.updated_at,
          'completedAt', visible.completed_at
        )
        order by
          case visible.task_status when 'blocked' then 0 when 'open' then 1 else 2 end,
          visible.due_date nulls last,
          visible.sort_order,
          visible.created_at
      ),
      '[]'::jsonb
    )
    into v_project_tasks
    from (
      select
        t.id as task_id,
        p.id as project_id,
        p.stable_key as project_key,
        p.title as project_title,
        p.farm_id,
        f.stable_key as farm_key,
        f.name as farm_name,
        p.workstream,
        t.title as task_title,
        t.status as task_status,
        t.priority,
        t.due_date,
        t.note,
        t.blocker_text,
        t.assigned_user_id,
        t.created_by_user_id,
        t.origin_kind,
        t.created_at,
        t.updated_at,
        t.completed_at,
        ptl.sort_order
      from atlas.projects p
      join atlas.project_task_links ptl on ptl.project_id = p.id
      join atlas.tasks t on t.id = ptl.task_id
      left join atlas.farms f on f.id = p.farm_id
      where p.organization_id = v_organization_id
        and p.status <> 'archived'
        and atlas.can_read_project(p.id)
        and t.task_scope = 'project'
        and lower(coalesce(t.metadata ->> 'project_tracking_only', 'false')) <> 'true'
        and atlas.project_task_visible_on_day_v1(
          t.status, t.due_date, t.completed_at, t.updated_at, t.metadata, p_done_date
        )
    ) visible;
  end if;

  select fm.farm_id
  into v_active_farm_id
  from atlas.farm_memberships fm
  join atlas.farms f on f.id = fm.farm_id
  where fm.user_id = v_user_id
    and fm.active = true
    and f.status = 'active'
  order by
    case when fm.farm_id = p_preferred_farm_id then 0 else 1 end,
    case when fm.role = 'owner' then 0 when fm.role = 'manager' then 1 else 2 end,
    f.name,
    fm.created_at
  limit 1;

  for v_farm in
    select
      fm.id as membership_id,
      fm.farm_id,
      fm.role,
      fm.worker_key,
      fm.permissions,
      f.stable_key as farm_key,
      f.name as farm_name,
      f.status as farm_status,
      f.organization_id
    from atlas.farm_memberships fm
    join atlas.farms f on f.id = fm.farm_id
    where fm.user_id = v_user_id
      and fm.active = true
      and f.status = 'active'
    order by
      case when fm.farm_id = v_active_farm_id then 0 else 1 end,
      case when fm.role = 'owner' then 0 when fm.role = 'manager' then 1 else 2 end,
      f.name,
      fm.created_at
  loop
    v_snapshot := atlas.farm_snapshot_for_member_v1(v_farm.farm_id);
    v_task_cards := '[]'::jsonb;

    if nullif(btrim(coalesce(v_farm.worker_key, '')), '') is not null then
      select coalesce(
        jsonb_agg(to_jsonb(card) order by card.due_date nulls last, card.created_at, card.task_id),
        '[]'::jsonb
      )
      into v_task_cards
      from atlas.home_task_cards_v2(
        v_farm.farm_id,
        v_farm.worker_key,
        p_due_through,
        p_done_date
      ) card;
    end if;

    if v_farm.role in ('owner', 'manager') then
      select
        count(*) filter (where t.status in ('open', 'blocked'))::integer,
        count(*) filter (where t.status = 'blocked')::integer,
        count(*) filter (
          where t.status = 'open'
            and t.due_date is not null
            and t.due_date < p_done_date
        )::integer,
        count(*) filter (
          where t.status in ('open', 'blocked')
            and t.due_date = p_done_date
        )::integer
      into v_open_count, v_blocked_count, v_overdue_count, v_due_today_count
      from atlas.tasks t
      where t.farm_id = v_farm.farm_id
        and t.task_scope = 'farm_operation'
        and t.status <> 'archived';
    else
      select
        count(*) filter (where (item ->> 'status') in ('open', 'blocked'))::integer,
        count(*) filter (where (item ->> 'status') = 'blocked')::integer,
        count(*) filter (
          where (item ->> 'status') = 'open'
            and nullif(item ->> 'due_date', '') is not null
            and (item ->> 'due_date')::date < p_done_date
        )::integer,
        count(*) filter (
          where (item ->> 'status') in ('open', 'blocked')
            and nullif(item ->> 'due_date', '') is not null
            and (item ->> 'due_date')::date = p_done_date
        )::integer
      into v_open_count, v_blocked_count, v_overdue_count, v_due_today_count
      from jsonb_array_elements(v_task_cards) item;
    end if;

    select greatest(
      (select max(t.updated_at) from atlas.tasks t where t.farm_id = v_farm.farm_id),
      (select max(fl.updated_at) from atlas.field_logs fl where fl.farm_id = v_farm.farm_id),
      (select max(oae.created_at) from atlas.object_activity_events oae where oae.farm_id = v_farm.farm_id)
    )
    into v_last_movement_at;

    v_farms := v_farms || jsonb_build_array(jsonb_build_object(
      'membershipId', v_farm.membership_id,
      'farmId', v_farm.farm_id,
      'farmKey', v_farm.farm_key,
      'farmName', v_farm.farm_name,
      'farmStatus', v_farm.farm_status,
      'organizationId', v_farm.organization_id,
      'role', v_farm.role,
      'workerKey', v_farm.worker_key,
      'permissions', coalesce(v_farm.permissions, '{}'::jsonb),
      'canManageFarm', v_farm.role in ('owner', 'manager'),
      'canUseOwnerTools', v_farm.role = 'owner',
      'snapshot', coalesce(v_snapshot, '{}'::jsonb),
      'taskCards', v_task_cards,
      'openTaskCount', coalesce(v_open_count, 0),
      'blockedTaskCount', coalesce(v_blocked_count, 0),
      'overdueTaskCount', coalesce(v_overdue_count, 0),
      'dueTodayCount', coalesce(v_due_today_count, 0),
      'lastMovementAt', v_last_movement_at
    ));
  end loop;

  if v_organization_id is null and jsonb_array_length(v_farms) = 0 then
    raise exception 'An active Atlas farm or organization membership is required.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'viewer', jsonb_build_object(
      'userId', v_user_id,
      'organizationId', v_organization_id,
      'organizationRole', v_organization_role,
      'activeFarmId', v_active_farm_id,
      'hasOrganizationScope', v_organization_id is not null,
      'hasFarmScope', jsonb_array_length(v_farms) > 0
    ),
    'organizationHome', v_organization_home,
    'projectTasks', v_project_tasks,
    'farms', v_farms,
    'window', jsonb_build_object(
      'doneDate', p_done_date,
      'dueThrough', p_due_through
    )
  );
end;
$function$;
