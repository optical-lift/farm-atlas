create or replace function atlas.task_move_context_batch_v1(p_task_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_result jsonb;
begin
  if v_user_id is null then
    raise exception 'Sign in required.' using errcode='42501';
  end if;

  select coalesce(jsonb_object_agg(t.id::text, jsonb_build_object(
    'projects', coalesce((
      select jsonb_agg(jsonb_build_object(
        'projectId', p.id,
        'projectKey', p.stable_key,
        'title', p.title,
        'portfolioType', p.portfolio_type,
        'targetDate', p.target_date,
        'linkRole', ptl.link_role,
        'path', atlas.project_path_v1(p.id),
        'goalText', p.goal_text,
        'outcomeText', p.outcome_text,
        'currentMilestone', p.current_milestone,
        'goals', coalesce((
          select jsonb_agg(jsonb_build_object(
            'goalId', pg.id,
            'label', pg.goal_label,
            'successDefinition', pg.success_definition,
            'targetDueDate', pg.target_due_date,
            'planningStatus', pg.planning_status
          ) order by pg.target_due_date nulls last, pg.created_at, pg.goal_label)
          from atlas.project_goals pg
          where pg.project_id = p.id
            and coalesce(pg.planning_status, '') <> 'archived'
        ), '[]'::jsonb)
      ) order by
        case p.portfolio_type when 'event' then 0 when 'side_quest' then 1 when 'campaign' then 2 when 'program' then 3 else 4 end,
        p.sort_order,
        p.title)
      from atlas.project_task_links ptl
      join atlas.projects p on p.id = ptl.project_id
      where ptl.task_id = t.id
        and p.status <> 'archived'
        and (t.assigned_user_id = v_user_id or atlas.can_read_project(p.id) or atlas.is_organization_owner(p.organization_id))
    ), '[]'::jsonb),
    'unlocks', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId', d.id,
        'title', d.title,
        'status', d.status,
        'assigneeName', coalesce(up.display_name, 'Unassigned'),
        'requiredStatus', tp.required_status,
        'holdMode', tp.hold_mode
      ) order by tp.sequence_order, d.due_date nulls last, d.title)
      from atlas.task_prerequisites tp
      join atlas.tasks d on d.id = tp.downstream_task_id
      left join atlas.user_profiles up on up.user_id = d.assigned_user_id
      where tp.prerequisite_task_id = t.id
        and tp.active = true
        and tp.satisfied_at is null
        and d.status not in ('done', 'skipped', 'archived')
    ), '[]'::jsonb),
    'waitingOn', coalesce((
      select jsonb_agg(jsonb_build_object(
        'taskId', pre.id,
        'title', pre.title,
        'status', pre.status,
        'assigneeName', coalesce(up.display_name, 'Unassigned'),
        'requiredStatus', tp.required_status,
        'holdMode', tp.hold_mode
      ) order by tp.sequence_order, pre.due_date nulls last, pre.title)
      from atlas.task_prerequisites tp
      join atlas.tasks pre on pre.id = tp.prerequisite_task_id
      left join atlas.user_profiles up on up.user_id = pre.assigned_user_id
      where tp.downstream_task_id = t.id
        and tp.active = true
        and tp.satisfied_at is null
    ), '[]'::jsonb)
  )), '{}'::jsonb)
  into v_result
  from atlas.tasks t
  where t.id = any(coalesce(p_task_ids, array[]::uuid[]))
    and (
      t.assigned_user_id = v_user_id
      or exists(
        select 1 from atlas.farm_memberships fm
        where fm.farm_id = t.farm_id and fm.user_id = v_user_id and fm.active = true
      )
      or exists(
        select 1 from atlas.project_task_links ptl
        where ptl.task_id = t.id and atlas.can_read_project(ptl.project_id)
      )
    );

  return v_result;
end;
$function$;
