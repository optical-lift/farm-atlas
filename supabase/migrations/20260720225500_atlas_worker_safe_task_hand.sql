create or replace function atlas.resolve_worker_view_membership_v1(
  p_farm_id uuid,
  p_target_membership_id uuid default null
)
returns uuid
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_role text;
  v_membership_id uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);

  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  if v_role = 'farm_hand' then
    return atlas.current_membership_id(p_farm_id);
  end if;

  if v_role not in ('owner', 'manager') then
    raise exception 'Worker view is not available to this role.' using errcode = '42501';
  end if;

  if p_target_membership_id is not null then
    select fm.id
    into v_membership_id
    from atlas.farm_memberships fm
    where fm.id = p_target_membership_id
      and fm.farm_id = p_farm_id
      and fm.role = 'farm_hand'
      and fm.active = true;
  else
    select fm.id
    into v_membership_id
    from atlas.farm_memberships fm
    where fm.farm_id = p_farm_id
      and fm.role = 'farm_hand'
      and fm.active = true
    order by fm.created_at, fm.id
    limit 1;
  end if;

  return v_membership_id;
end;
$function$;

revoke all on function atlas.resolve_worker_view_membership_v1(uuid, uuid) from public, anon, authenticated;

create or replace function atlas.worker_hand_context_v1(
  p_farm_id uuid,
  p_target_membership_id uuid default null
)
returns table (
  farm_id uuid,
  farm_name text,
  viewer_role text,
  worker_membership_id uuid,
  worker_display_name text,
  worker_key text,
  can_act boolean,
  unassigned_worker_task_count bigint
)
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_role text;
  v_current_membership_id uuid;
  v_target_membership_id uuid;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_current_membership_id := atlas.current_membership_id(p_farm_id);
  v_target_membership_id := atlas.resolve_worker_view_membership_v1(
    p_farm_id,
    p_target_membership_id
  );

  return query
  select
    f.id,
    f.name,
    v_role,
    fm.id,
    coalesce(up.display_name, au.email, fm.worker_key, 'Farm Hand')::text,
    fm.worker_key,
    (v_role = 'farm_hand' and fm.id = v_current_membership_id),
    case
      when v_role in ('owner', 'manager') then (
        select count(*)
        from atlas.tasks t
        where t.farm_id = p_farm_id
          and t.visibility_scope = 'assigned_worker'
          and t.assigned_membership_id is null
          and t.status in ('open', 'blocked')
      )
      else 0::bigint
    end
  from atlas.farms f
  left join atlas.farm_memberships fm
    on fm.id = v_target_membership_id
  left join auth.users au
    on au.id = fm.user_id
  left join atlas.user_profiles up
    on up.user_id = fm.user_id
  where f.id = p_farm_id;
end;
$function$;

revoke all on function atlas.worker_hand_context_v1(uuid, uuid) from public, anon;
grant execute on function atlas.worker_hand_context_v1(uuid, uuid) to authenticated;

create or replace function atlas.worker_task_hand_v1(
  p_farm_id uuid,
  p_for_date date default current_date,
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
  assigned_membership_id uuid,
  visibility_scope text,
  task_lane text,
  total_steps bigint,
  completed_steps bigint,
  can_act boolean
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
  v_can_act boolean;
begin
  v_role := atlas.current_farm_role(p_farm_id);
  if v_role is null then
    raise exception 'Active farm membership required.' using errcode = '42501';
  end if;

  v_current_membership_id := atlas.current_membership_id(p_farm_id);
  v_target_membership_id := atlas.resolve_worker_view_membership_v1(
    p_farm_id,
    p_target_membership_id
  );

  if v_target_membership_id is null then
    return;
  end if;

  v_can_act := v_role = 'farm_hand'
    and v_current_membership_id = v_target_membership_id;

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
    t.assigned_membership_id,
    t.visibility_scope,
    case
      when t.status = 'blocked' then 'blocked'
      when t.due_date is not null and t.due_date < p_for_date then 'overdue'
      when t.due_date = p_for_date then 'today'
      else 'undated'
    end,
    (
      select count(*)
      from atlas.tasks c
      where c.farm_id = t.farm_id
        and (
          c.parent_task_id = t.id
          or c.metadata->>'parent_task_id' = t.id::text
        )
        and c.status <> 'archived'
    ),
    (
      select count(*)
      from atlas.tasks c
      where c.farm_id = t.farm_id
        and (
          c.parent_task_id = t.id
          or c.metadata->>'parent_task_id' = t.id::text
        )
        and c.status = 'done'
    ),
    v_can_act and t.visibility_scope = 'assigned_worker'
  from atlas.tasks t
  left join atlas.zones z on z.id = t.zone_id
  where t.farm_id = p_farm_id
    and t.status in ('open', 'blocked')
    and t.parent_task_id is null
    and t.metadata->>'parent_task_id' is null
    and coalesce((t.metadata->>'is_child_task')::boolean, false) = false
    and (
      (
        t.visibility_scope = 'assigned_worker'
        and t.assigned_membership_id = v_target_membership_id
      )
      or t.visibility_scope = 'farm_shared'
    )
    and (t.due_date is null or t.due_date <= p_for_date)
  order by
    case
      when t.status = 'blocked' then 0
      when t.due_date is not null and t.due_date < p_for_date then 1
      when t.due_date = p_for_date then 2
      else 3
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
  limit 40;
end;
$function$;

revoke all on function atlas.worker_task_hand_v1(uuid, date, uuid) from public, anon;
grant execute on function atlas.worker_task_hand_v1(uuid, date, uuid) to authenticated;

create or replace function atlas.worker_record_task_transition_v1(
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_note text default null,
  p_reason text default null,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas'
as $function$
declare
  v_farm_id uuid;
  v_visibility_scope text;
  v_assigned_membership_id uuid;
  v_current_membership_id uuid;
  v_role text;
  v_payload jsonb;
begin
  select
    t.farm_id,
    t.visibility_scope,
    t.assigned_membership_id
  into
    v_farm_id,
    v_visibility_scope,
    v_assigned_membership_id
  from atlas.tasks t
  where t.id = p_task_id;

  if v_farm_id is null then
    raise exception 'Task not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_farm_id);
  v_current_membership_id := atlas.current_membership_id(v_farm_id);

  if v_role <> 'farm_hand'
    or v_current_membership_id is null
    or v_visibility_scope <> 'assigned_worker'
    or v_assigned_membership_id <> v_current_membership_id
  then
    raise exception 'This task is not assigned to the signed-in Farm Hand.' using errcode = '42501';
  end if;

  if p_transition not in ('done', 'blocked', 'note') then
    raise exception 'Unsupported Farm-Hand transition.' using errcode = '22023';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_current_membership_id,
    'actor_role', 'farm_hand'
  );

  return atlas.record_task_transition_v1(
    p_task_id,
    p_transition,
    p_idempotency_key,
    null,
    p_note,
    p_reason,
    null,
    null,
    v_payload,
    null
  );
end;
$function$;

revoke all on function atlas.worker_record_task_transition_v1(uuid, text, text, text, text, jsonb) from public, anon;
grant execute on function atlas.worker_record_task_transition_v1(uuid, text, text, text, text, jsonb) to authenticated;
