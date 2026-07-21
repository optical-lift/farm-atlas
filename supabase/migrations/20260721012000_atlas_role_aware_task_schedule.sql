create or replace function atlas.task_schedule_v1(
  p_farm_id uuid,
  p_start_date date,
  p_end_date date,
  p_include_overdue boolean default false,
  p_include_undated boolean default false,
  p_target_membership_id uuid default null
)
returns table (
  task_id uuid,
  title text,
  task_type text,
  status text,
  priority text,
  due_date date,
  instruction text,
  blocker_text text,
  zone_id uuid,
  zone_key text,
  zone_label text,
  object_id uuid,
  object_key text,
  object_label text,
  assigned_membership_id uuid,
  assigned_display_name text,
  assigned_worker_key text,
  visibility_scope text,
  schedule_lane text,
  total_steps bigint,
  completed_steps bigint,
  can_act boolean,
  counts_for_window boolean
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_role text;
  v_current_membership_id uuid;
  v_target_membership_id uuid;
begin
  if p_start_date is null or p_end_date is null then
    raise exception 'Schedule start and end dates are required.' using errcode = '22023';
  end if;

  if p_end_date < p_start_date then
    raise exception 'Schedule end date must not precede start date.' using errcode = '22023';
  end if;

  if p_end_date - p_start_date > 62 then
    raise exception 'Schedule windows may not exceed 63 days.' using errcode = '22023';
  end if;

  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_current_membership_id := atlas.current_membership_id(p_farm_id);

  if v_role = 'farm_hand' then
    v_target_membership_id := v_current_membership_id;
  elsif p_target_membership_id is not null then
    select fm.id
    into v_target_membership_id
    from atlas.farm_memberships fm
    where fm.id = p_target_membership_id
      and fm.farm_id = p_farm_id
      and fm.active = true;

    if v_target_membership_id is null then
      raise exception 'Target membership is not active on this farm.' using errcode = '42501';
    end if;
  end if;

  return query
  select
    t.id,
    t.title,
    t.task_type,
    t.status,
    t.priority,
    t.due_date,
    coalesce(nullif(btrim(t.note), ''), nullif(btrim(t.unlock_text), '')),
    nullif(btrim(t.blocker_text), ''),
    z.id,
    z.stable_key,
    z.label,
    primary_object.object_id,
    primary_object.object_key,
    primary_object.object_label,
    t.assigned_membership_id,
    coalesce(up.display_name, assigned.worker_key, 'Farm Team')::text,
    assigned.worker_key,
    t.visibility_scope,
    case
      when t.status = 'done' then 'completed'
      when t.status = 'blocked' then 'blocked'
      when t.due_date is not null and t.due_date < p_start_date then 'overdue'
      when t.due_date is null then 'undated'
      when p_start_date = p_end_date and t.due_date = p_start_date then 'today'
      else 'scheduled'
    end,
    (
      select count(*)
      from atlas.tasks child
      where child.farm_id = t.farm_id
        and (
          child.parent_task_id = t.id
          or child.metadata->>'parent_task_id' = t.id::text
        )
        and child.status <> 'archived'
    ),
    (
      select count(*)
      from atlas.tasks child
      where child.farm_id = t.farm_id
        and (
          child.parent_task_id = t.id
          or child.metadata->>'parent_task_id' = t.id::text
        )
        and child.status = 'done'
    ),
    v_role = 'farm_hand'
      and t.status in ('open', 'blocked')
      and t.visibility_scope = 'assigned_worker'
      and t.assigned_membership_id = v_current_membership_id,
    t.due_date between p_start_date and p_end_date
  from atlas.tasks t
  left join atlas.zones z on z.id = t.zone_id
  left join atlas.farm_memberships assigned on assigned.id = t.assigned_membership_id
  left join atlas.user_profiles up on up.user_id = assigned.user_id
  left join lateral (
    select
      go.id as object_id,
      go.stable_key as object_key,
      go.label as object_label
    from atlas.task_objects task_link
    join atlas.growing_objects go on go.id = task_link.object_id
    where task_link.task_id = t.id
    order by
      case when task_link.role = 'target' then 0 else 1 end,
      go.sort_order,
      go.label
    limit 1
  ) primary_object on true
  where t.farm_id = p_farm_id
    and t.status in ('open', 'blocked', 'done')
    and t.parent_task_id is null
    and t.metadata->>'parent_task_id' is null
    and coalesce((t.metadata->>'is_child_task')::boolean, false) = false
    and (
      (v_role = 'owner' and t.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared'))
      or (v_role = 'manager' and t.visibility_scope in ('management', 'assigned_worker', 'farm_shared'))
      or (
        v_role = 'farm_hand'
        and (
          (t.visibility_scope = 'assigned_worker' and t.assigned_membership_id = v_current_membership_id)
          or t.visibility_scope = 'farm_shared'
        )
      )
    )
    and (
      v_target_membership_id is null
      or t.assigned_membership_id = v_target_membership_id
      or t.visibility_scope = 'farm_shared'
    )
    and (
      t.due_date between p_start_date and p_end_date
      or (
        t.status in ('open', 'blocked')
        and p_include_overdue
        and t.due_date < p_start_date
      )
      or (
        t.status in ('open', 'blocked')
        and p_include_undated
        and t.due_date is null
      )
    )
  order by
    case
      when t.status = 'blocked' then 0
      when t.status in ('open', 'blocked') and t.due_date is not null and t.due_date < p_start_date then 1
      when t.status = 'done' then 3
      when t.due_date is null then 4
      else 2
    end,
    t.due_date nulls last,
    case t.priority
      when 'urgent' then 0
      when 'high' then 1
      when 'normal' then 2
      when 'low' then 3
      else 4
    end,
    coalesce((t.metadata->>'day_order')::integer, 999),
    t.created_at
  limit 1000;
end;
$function$;

revoke all on function atlas.task_schedule_v1(uuid, date, date, boolean, boolean, uuid) from public, anon;
grant execute on function atlas.task_schedule_v1(uuid, date, date, boolean, boolean, uuid) to authenticated;