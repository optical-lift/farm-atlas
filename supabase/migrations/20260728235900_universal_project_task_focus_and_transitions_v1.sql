create or replace function atlas.project_task_focus_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'organizationName', o.name,
    'project', atlas.portfolio_project_card_v1(p.id),
    'task', jsonb_build_object(
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
      'updatedAt', t.updated_at,
      'completedAt', t.completed_at
    ),
    'step', (
      select jsonb_build_object(
        'stepId', ps.id,
        'title', ps.title,
        'status', ps.status,
        'stepOrder', ps.step_order,
        'linkedTaskId', ps.linked_task_id,
        'note', ps.note
      )
      from atlas.project_steps ps
      where ps.project_id = p.id and ps.linked_task_id = t.id
      order by ps.step_order
      limit 1
    ),
    'permissions', jsonb_build_object(
      'canComplete', t.assigned_user_id = auth.uid() or atlas.is_organization_owner(p.organization_id),
      'canEdit', t.assigned_user_id = auth.uid() or atlas.is_organization_owner(p.organization_id),
      'isOrganizationOwner', atlas.is_organization_owner(p.organization_id)
    )
  )
  into v_result
  from atlas.project_task_links ptl
  join atlas.tasks t on t.id = ptl.task_id
  join atlas.projects p on p.id = ptl.project_id
  join atlas.organizations o on o.id = p.organization_id
  where t.id = p_task_id
    and t.task_scope = 'project'
    and atlas.can_read_project(p.id)
  order by ptl.created_at
  limit 1;

  return v_result;
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

  update atlas.projects
  set last_movement_at = now(),
      health_status = v_health,
      updated_at = now()
  where id = v_project_id;

  return p_task_id;
end;
$$;

grant execute on function atlas.project_task_focus_v1(uuid) to authenticated;
grant execute on function atlas.transition_project_task_v1(uuid, text, text) to authenticated;
revoke all on function atlas.project_task_focus_v1(uuid) from anon;
revoke all on function atlas.transition_project_task_v1(uuid, text, text) from anon;
