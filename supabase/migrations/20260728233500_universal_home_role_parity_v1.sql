create or replace function atlas.universal_home_v1(
  p_organization_id uuid default null,
  p_preferred_farm_id uuid default null,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $$
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
        and (
          t.status in ('open', 'blocked')
          or (
            t.status = 'done'
            and coalesce(t.completed_at::date, t.updated_at::date) = p_done_date
          )
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
$$;

grant execute on function atlas.universal_home_v1(uuid, uuid, date, date) to authenticated;

comment on function atlas.universal_home_v1(uuid, uuid, date, date) is
  'Prepared Atlas home read model combining every active farm membership with visible organization projects and their real current task cards for the signed-in user.';
