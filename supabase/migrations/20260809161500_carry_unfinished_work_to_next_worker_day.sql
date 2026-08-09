create or replace function atlas.member_day_carryover_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date
)
returns table(
  task_id uuid,
  previous_work_date date,
  expected_active_minutes integer,
  effective_obligation_class text
)
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $$
declare
  v_user_id uuid;
  v_previous_work_date date;
  v_today date := (now() at time zone 'America/Chicago')::date;
begin
  select fm.user_id
  into v_user_id
  from atlas.farm_memberships fm
  where fm.id = p_membership_id
    and fm.farm_id = p_farm_id
    and fm.active = true;

  if not found then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if v_user_id is distinct from auth.uid()
     and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s carry-forward work.' using errcode = '42501';
  end if;

  if p_work_date < v_today then
    return;
  end if;

  if extract(isodow from p_work_date) = 7 then
    return;
  end if;

  if exists (
    select 1
    from atlas.member_unavailability u
    where u.farm_id = p_farm_id
      and u.membership_id = p_membership_id
      and u.active = true
      and p_work_date between u.unavailable_start and u.unavailable_end
  ) then
    return;
  end if;

  v_previous_work_date := p_work_date - 1;
  loop
    exit when extract(isodow from v_previous_work_date) <> 7
      and not exists (
        select 1
        from atlas.member_unavailability u
        where u.farm_id = p_farm_id
          and u.membership_id = p_membership_id
          and u.active = true
          and v_previous_work_date between u.unavailable_start and u.unavailable_end
      );
    v_previous_work_date := v_previous_work_date - 1;
  end loop;

  return query
  with target_presented as (
    select p.task_id
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, p_work_date) p
    where p.presentation_state in ('attention', 'presented')
  ), prior_presented as (
    select p.task_id, p.lane_order, p.selection_rank
    from atlas.presented_work_rows_v1(p_farm_id, p_membership_id, v_previous_work_date) p
    where p.presentation_state in ('attention', 'presented')
  )
  select
    t.id,
    v_previous_work_date,
    capacity.expected_active_minutes,
    capacity.effective_obligation_class
  from prior_presented prior
  join atlas.tasks t on t.id = prior.task_id
  cross join lateral atlas.task_capacity_plan_v1(t, p_work_date) capacity
  where t.status in ('open', 'blocked')
    and not exists (
      select 1 from target_presented target where target.task_id = t.id
    )
    and coalesce(
      (atlas.task_sky_presentation_gate_v1(t.id, p_work_date) ->> 'withheldUnderSky')::boolean,
      false
    ) = false
  order by prior.lane_order, prior.selection_rank, t.id;
end;
$$;

revoke all on function atlas.member_day_carryover_v1(uuid, uuid, date) from public, anon, authenticated;
grant execute on function atlas.member_day_carryover_v1(uuid, uuid, date) to service_role;

create or replace function atlas.home_task_cards_for_membership_v2(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date default null::date,
  p_done_date date default null::date
)
returns setof atlas.v_task_cards
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $$
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
  ), personal_carry as (
    select
      carry.task_id,
      1 as surface_group,
      1 as lane_order,
      row_number() over (order by task.due_date nulls last, task.priority, task.created_at) as selection_rank
    from atlas.member_day_carryover_v1(p_farm_id, p_membership_id, v_day) carry
    join atlas.tasks task on task.id = carry.task_id
  ), personal_scheduled as (
    select
      task.id as task_id,
      2 as surface_group,
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
      3 as surface_group,
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
    select * from personal_carry
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
  order by selected.surface_group, selected.lane_order, selected.selection_rank;
end;
$$;

create or replace function atlas.owner_operator_home_task_cards_v1(
  p_effective_membership_id uuid,
  p_due_through date default null::date,
  p_done_date date default null::date
)
returns setof atlas.v_task_cards
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas'
as $$
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
  from atlas.home_task_cards_for_membership_v2(
    v_farm_id,
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;
end;
$$;
