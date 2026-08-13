begin;

create or replace function atlas.home_task_cards_for_membership_v3(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date,
  p_done_date date
)
returns setof atlas.v_task_cards
language sql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
  select card.*
  from atlas.home_task_cards_for_membership_v2(
    p_farm_id,
    p_membership_id,
    p_due_through,
    p_done_date
  ) card

  union

  select card.*
  from atlas.v_task_cards card
  where p_done_date is not null
    and card.farm_id = p_farm_id
    and card.assigned_membership_id = p_membership_id
    and card.parent_task_id is null
    and card.status = 'done'
    and card.completed_at is not null
    and (card.completed_at at time zone 'America/Chicago')::date = p_done_date;
$function$;

create or replace function atlas.home_task_cards_v2(
  p_farm_id uuid,
  p_worker_key text,
  p_due_through date,
  p_done_date date
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_membership_id uuid;
  v_worker_key text;
  v_requested_worker_key text := nullif(lower(btrim(p_worker_key)), '');
begin
  v_membership_id := atlas.current_membership_id(p_farm_id);
  if v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  select nullif(lower(btrim(membership.worker_key)), '')
  into v_worker_key
  from atlas.farm_memberships membership
  where membership.id = v_membership_id
    and membership.farm_id = p_farm_id
    and membership.active = true;

  if v_worker_key is null then
    raise exception 'Current Atlas worker identity was not found.' using errcode = 'P0002';
  end if;

  if v_requested_worker_key is not null
     and v_requested_worker_key is distinct from v_worker_key then
    raise exception 'The home reader may only load the signed-in membership.' using errcode = '42501';
  end if;

  return query
  select card.*
  from atlas.home_task_cards_for_membership_v3(
    p_farm_id,
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;
end;
$function$;

create or replace function atlas.owner_operator_home_task_cards_v1(
  p_effective_membership_id uuid,
  p_due_through date default null::date,
  p_done_date date default null::date
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_context jsonb;
  v_farm_id uuid;
  v_membership_id uuid;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;

  return query
  select card.*
  from atlas.home_task_cards_for_membership_v3(
    v_farm_id,
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;
end;
$function$;

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
        'assigneeMembershipId', d.assigned_membership_id,
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
        'assigneeMembershipId', pre.assigned_membership_id,
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

create or replace function atlas.sync_operation_place_readiness_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_place_key text := nullif(new.metadata ->> 'operation_place_key', '');
  v_tracks boolean := lower(coalesce(new.metadata ->> 'place_readiness_on_done', 'false')) in ('true','yes','1');
begin
  if v_place_key is null or not v_tracks then
    return new;
  end if;

  if new.status = 'done' and old.status is distinct from 'done' then
    update atlas.places p
    set facts = coalesce(p.facts, '{}'::jsonb) || jsonb_build_object(
          'readiness', 'ready',
          'last_prepared_at', now(),
          'last_prepared_task_id', new.id
        ),
        updated_at = now()
    where p.farm_id = new.farm_id
      and p.stable_key = v_place_key;
  elsif old.status = 'done' and new.status <> 'done' then
    update atlas.places p
    set facts = coalesce(p.facts, '{}'::jsonb) || jsonb_build_object(
          'readiness', 'needs_check',
          'readiness_changed_at', now(),
          'readiness_changed_by_task_id', new.id
        ),
        updated_at = now()
    where p.farm_id = new.farm_id
      and p.stable_key = v_place_key;
  end if;

  return new;
end;
$function$;

drop trigger if exists trg_sync_operation_place_readiness_v1 on atlas.tasks;
create trigger trg_sync_operation_place_readiness_v1
after update of status on atlas.tasks
for each row
when (old.status is distinct from new.status)
execute function atlas.sync_operation_place_readiness_v1();

commit;
