create or replace function atlas.home_task_cards_for_membership_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
)
returns setof atlas.v_task_cards
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_role text;
  v_user_id uuid;
  v_worker_key text;
  v_day date := coalesce(p_done_date, (now() at time zone 'America/Chicago')::date);
  v_due_through date := coalesce(p_due_through, v_day + 35);
begin
  select fm.role, fm.user_id, nullif(lower(btrim(fm.worker_key)), '')
  into v_role, v_user_id, v_worker_key
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if v_user_id is distinct from auth.uid()
     and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s work.' using errcode = '42501';
  end if;

  return query
  with personal_presented as (
    select presented.task_id, 0 as surface_group, presented.lane_order, presented.selection_rank
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_day) presented
    join atlas.tasks task on task.id = presented.task_id
    where presented.presentation_state in ('attention', 'presented')
      and (
        task.assigned_membership_id = p_membership_id
        or task.assigned_user_id = v_user_id
        or task.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (
          v_worker_key is not null
          and lower(coalesce(
            nullif(task.metadata ->> 'executor_worker_key', ''),
            nullif(task.metadata ->> 'assignee_key', ''),
            nullif(task.metadata ->> 'assigned_to', '')
          )) = v_worker_key
        )
        or (
          v_role = 'owner'
          and task.assigned_membership_id is null
          and task.assigned_user_id is null
          and (
            lower(coalesce(task.metadata ->> 'owner_task', 'false')) = 'true'
            or lower(coalesce(task.metadata ->> 'assigned_to', '')) = 'owner'
            or task.visibility_scope = 'owner'
          )
        )
      )
  ), personal_scheduled as (
    select
      task.id as task_id,
      1 as surface_group,
      1 as lane_order,
      row_number() over (order by task.due_date, task.priority, task.created_at) as selection_rank
    from atlas.tasks task
    where task.farm_id = p_farm_id
      and task.parent_task_id is null
      and nullif(task.metadata ->> 'parent_task_id', '') is null
      and nullif(task.metadata ->> 'parentTaskId', '') is null
      and lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      and (
        task.assigned_membership_id = p_membership_id
        or task.assigned_user_id = v_user_id
        or task.metadata ->> 'executor_membership_id' = p_membership_id::text
        or (
          v_worker_key is not null
          and lower(coalesce(
            nullif(task.metadata ->> 'executor_worker_key', ''),
            nullif(task.metadata ->> 'assignee_key', ''),
            nullif(task.metadata ->> 'assigned_to', '')
          )) = v_worker_key
        )
        or (
          v_role = 'owner'
          and task.assigned_membership_id is null
          and task.assigned_user_id is null
          and (
            lower(coalesce(task.metadata ->> 'owner_task', 'false')) = 'true'
            or lower(coalesce(task.metadata ->> 'assigned_to', '')) = 'owner'
            or task.visibility_scope = 'owner'
          )
        )
      )
      and (
        (
          task.status in ('open', 'blocked')
          and task.work_lane = 'required'
          and task.commitment_kind = 'hard_date'
          and task.due_date > v_day
          and task.due_date <= v_due_through
        )
        or (
          task.status = 'done'
          and p_done_date is not null
          and task.due_date = p_done_date
        )
      )
  ), alongside as (
    select
      task.id as task_id,
      2 as surface_group,
      1 as lane_order,
      row_number() over (order by task.due_date, task.priority, task.created_at) as selection_rank
    from atlas.work_alongside_windows alongside_window
    join atlas.tasks task
      on task.farm_id = alongside_window.farm_id
     and task.assigned_membership_id = alongside_window.teammate_membership_id
    where v_role in ('owner', 'manager')
      and alongside_window.farm_id = p_farm_id
      and alongside_window.observer_membership_id = p_membership_id
      and alongside_window.status = 'active'
      and task.visibility_scope = 'assigned_worker'
      and task.parent_task_id is null
      and nullif(task.metadata ->> 'parent_task_id', '') is null
      and nullif(task.metadata ->> 'parentTaskId', '') is null
      and lower(coalesce(task.metadata ->> 'is_child_task', 'false')) <> 'true'
      and task.due_date between alongside_window.starts_on and alongside_window.ends_on
      and (
        (task.status in ('open', 'blocked') and task.due_date <= v_due_through)
        or (task.status = 'done' and p_done_date is not null and task.due_date = p_done_date)
      )
  ), chosen as (
    select * from personal_presented
    union all
    select * from personal_scheduled
    union all
    select * from alongside
  ), deduped as (
    select distinct on (task_id)
      task_id,
      surface_group,
      lane_order,
      selection_rank
    from chosen
    order by task_id, surface_group, lane_order, selection_rank
  )
  select card.*
  from deduped selected
  join atlas.v_task_cards card on card.task_id = selected.task_id
  where card.status in ('open', 'blocked', 'done')
    and (
      v_due_through = v_day
      or (
        (
          card.task_type = 'grow_room_care'
          and lower(card.title) in ('grow room care', 'water + check grow room', 'check grow room')
        )
        or not (
          coalesce(card.zone_key, '') = 'grow_room'
          or coalesce(card.zone_label, '') ilike '%grow room%'
          or coalesce(card.metadata ->> 'collection_zone', '') ilike '%grow room%'
          or coalesce(card.metadata ->> 'location_label', '') ilike '%grow room%'
          or coalesce(card.metadata ->> 'work_route', '') in (
            'grow_room_check', 'grow_room_audit', 'pot_up', 'hardening_off',
            'soil_block', 'grow_room_setup', 'grow_room_care'
          )
        )
      )
    )
  order by selected.surface_group, selected.lane_order, selected.selection_rank;
end;
$function$;
