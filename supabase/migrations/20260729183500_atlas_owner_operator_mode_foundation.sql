create or replace function atlas.owner_operator_context_v1(
  p_effective_membership_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_user_id uuid := auth.uid();
  v_actor atlas.farm_memberships%rowtype;
  v_effective atlas.farm_memberships%rowtype;
  v_actor_name text;
  v_effective_name text;
  v_farm_key text;
  v_farm_name text;
  v_options jsonb := '[]'::jsonb;
begin
  if v_user_id is null then
    raise exception 'Authenticated user required.' using errcode = '42501';
  end if;

  if p_effective_membership_id is not null then
    select owner_membership.*
    into v_actor
    from atlas.farm_memberships owner_membership
    join atlas.farm_memberships target_membership
      on target_membership.id = p_effective_membership_id
     and target_membership.farm_id = owner_membership.farm_id
     and target_membership.active = true
    where owner_membership.user_id = v_user_id
      and owner_membership.active = true
      and owner_membership.role = 'owner'
    order by owner_membership.created_at
    limit 1;
  else
    select owner_membership.*
    into v_actor
    from atlas.farm_memberships owner_membership
    left join atlas.user_profiles profile on profile.user_id = v_user_id
    where owner_membership.user_id = v_user_id
      and owner_membership.active = true
      and owner_membership.role = 'owner'
    order by
      case when owner_membership.farm_id = profile.default_farm_id then 0 else 1 end,
      owner_membership.created_at
    limit 1;
  end if;

  if v_actor.id is null then
    raise exception 'Owner membership required for operator mode.' using errcode = '42501';
  end if;

  if p_effective_membership_id is null then
    v_effective := v_actor;
  else
    select target_membership.*
    into v_effective
    from atlas.farm_memberships target_membership
    where target_membership.id = p_effective_membership_id
      and target_membership.farm_id = v_actor.farm_id
      and target_membership.active = true;
  end if;

  if v_effective.id is null then
    raise exception 'The requested worker is not active on this owner farm.' using errcode = '42501';
  end if;

  select
    coalesce(actor_profile.display_name, nullif(initcap(replace(v_actor.worker_key, '_', ' ')), ''), 'Owner'),
    coalesce(effective_profile.display_name, nullif(initcap(replace(v_effective.worker_key, '_', ' ')), ''), initcap(v_effective.role)),
    farm.stable_key,
    farm.name
  into v_actor_name, v_effective_name, v_farm_key, v_farm_name
  from atlas.farms farm
  left join atlas.user_profiles actor_profile on actor_profile.user_id = v_actor.user_id
  left join atlas.user_profiles effective_profile on effective_profile.user_id = v_effective.user_id
  where farm.id = v_actor.farm_id;

  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'membershipId', membership.id,
        'farmId', membership.farm_id,
        'role', membership.role,
        'workerKey', membership.worker_key,
        'displayName', coalesce(profile.display_name, nullif(initcap(replace(membership.worker_key, '_', ' ')), ''), initcap(membership.role)),
        'isActor', membership.id = v_actor.id
      )
      order by
        case when membership.id = v_actor.id then 0 else 1 end,
        case membership.role when 'owner' then 0 when 'manager' then 1 else 2 end,
        coalesce(profile.display_name, membership.worker_key)
    ),
    '[]'::jsonb
  )
  into v_options
  from atlas.farm_memberships membership
  left join atlas.user_profiles profile on profile.user_id = membership.user_id
  where membership.farm_id = v_actor.farm_id
    and membership.active = true;

  return jsonb_build_object(
    'available', true,
    'isOperating', v_effective.id <> v_actor.id,
    'farmId', v_actor.farm_id,
    'farmKey', v_farm_key,
    'farmName', v_farm_name,
    'actor', jsonb_build_object(
      'userId', v_user_id,
      'membershipId', v_actor.id,
      'role', v_actor.role,
      'workerKey', v_actor.worker_key,
      'displayName', v_actor_name
    ),
    'effective', jsonb_build_object(
      'userId', v_effective.user_id,
      'membershipId', v_effective.id,
      'role', v_effective.role,
      'workerKey', v_effective.worker_key,
      'displayName', v_effective_name,
      'permissions', coalesce(v_effective.permissions, '{}'::jsonb)
    ),
    'options', v_options
  );
end;
$function$;

create or replace function atlas.owner_operator_home_task_cards_v1(
  p_effective_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
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
  v_role text;
  v_task_ids uuid[] := '{}'::uuid[];
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';

  select coalesce(array_agg(task.id), '{}'::uuid[])
  into v_task_ids
  from atlas.tasks task
  where task.farm_id = v_farm_id
    and task.status <> 'archived'
    and (
      task.visibility_scope = 'farm_shared'
      or (
        task.visibility_scope = 'assigned_worker'
        and task.assigned_membership_id = v_membership_id
      )
      or (
        v_role = 'owner'
        and task.visibility_scope = 'owner'
        and (
          task.assigned_membership_id is null
          or task.assigned_membership_id = v_membership_id
        )
      )
    )
    and (
      (
        task.status in ('open', 'blocked')
        and (p_due_through is null or task.due_date is null or task.due_date <= p_due_through)
      )
      or (
        task.status = 'done'
        and p_done_date is not null
        and task.due_date = p_done_date
      )
    );

  if cardinality(v_task_ids) = 0 then
    return;
  end if;

  return query
  select card.*
  from atlas.v_task_cards card
  where card.task_id = any(v_task_ids)
  order by card.due_date nulls last, card.priority, card.created_at;
end;
$function$;

create or replace function atlas.owner_operator_task_cards_v1(
  p_effective_membership_id uuid,
  p_task_id uuid default null
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
  v_role text;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';

  return query
  select card.*
  from atlas.v_task_cards card
  join atlas.tasks task on task.id = card.task_id
  where task.farm_id = v_farm_id
    and task.status <> 'archived'
    and (p_task_id is null or task.id = p_task_id)
    and (
      (v_role = 'owner' and task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared'))
      or (v_role = 'manager' and (
        task.visibility_scope in ('management', 'farm_shared')
        or (task.visibility_scope = 'assigned_worker' and task.assigned_membership_id = v_membership_id)
      ))
      or (v_role = 'farm_hand' and (
        task.visibility_scope = 'farm_shared'
        or (task.visibility_scope = 'assigned_worker' and task.assigned_membership_id = v_membership_id)
      ))
    )
  order by card.due_date nulls last, card.created_at;
end;
$function$;

create or replace function atlas.owner_operator_universal_home_v1(
  p_effective_membership_id uuid,
  p_organization_id uuid default null,
  p_preferred_farm_id uuid default null,
  p_due_through date default (current_date + 35),
  p_done_date date default current_date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_base jsonb;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_worker_key text;
  v_permissions jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_target_farm jsonb;
  v_open_count integer := 0;
  v_blocked_count integer := 0;
  v_overdue_count integer := 0;
  v_due_today_count integer := 0;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';
  v_worker_key := v_context #>> '{effective,workerKey}';
  v_permissions := coalesce(v_context #> '{effective,permissions}', '{}'::jsonb);

  v_base := atlas.universal_home_v1(
    p_organization_id,
    coalesce(p_preferred_farm_id, v_farm_id),
    p_due_through,
    p_done_date
  );

  select coalesce(
    jsonb_agg(to_jsonb(card) order by card.due_date nulls last, card.created_at, card.task_id),
    '[]'::jsonb
  )
  into v_cards
  from atlas.owner_operator_home_task_cards_v1(
    v_membership_id,
    p_due_through,
    p_done_date
  ) card;

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
  from jsonb_array_elements(v_cards) item;

  select farm_item
  into v_target_farm
  from jsonb_array_elements(coalesce(v_base -> 'farms', '[]'::jsonb)) farm_item
  where farm_item ->> 'farmId' = v_farm_id::text
  limit 1;

  if v_target_farm is null then
    raise exception 'The owner farm could not be loaded for operator mode.' using errcode = '42501';
  end if;

  v_target_farm := v_target_farm || jsonb_build_object(
    'membershipId', v_membership_id,
    'role', v_role,
    'workerKey', v_worker_key,
    'permissions', v_permissions,
    'canManageFarm', v_role in ('owner', 'manager'),
    'canUseOwnerTools', v_role = 'owner',
    'taskCards', v_cards,
    'openTaskCount', coalesce(v_open_count, 0),
    'blockedTaskCount', coalesce(v_blocked_count, 0),
    'overdueTaskCount', coalesce(v_overdue_count, 0),
    'dueTodayCount', coalesce(v_due_today_count, 0)
  );

  v_base := jsonb_set(v_base, '{farms}', jsonb_build_array(v_target_farm), true);
  v_base := jsonb_set(v_base, '{organizationHome}', 'null'::jsonb, true);
  v_base := jsonb_set(v_base, '{projectTasks}', '[]'::jsonb, true);
  v_base := jsonb_set(
    v_base,
    '{viewer}',
    coalesce(v_base -> 'viewer', '{}'::jsonb) || jsonb_build_object(
      'activeFarmId', v_farm_id,
      'organizationId', null,
      'organizationRole', null,
      'hasOrganizationScope', false,
      'hasFarmScope', true
    ),
    true
  );

  return v_base || jsonb_build_object('operatorContext', v_context);
end;
$function$;

create or replace function atlas.owner_operator_record_task_transition_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_transition text,
  p_idempotency_key text,
  p_target_date date default null,
  p_note text default null,
  p_reason text default null,
  p_lane_key text default null,
  p_work_key text default null,
  p_payload jsonb default '{}'::jsonb,
  p_existing_field_log_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_effective_membership_id uuid;
  v_effective_role text;
  v_actor_membership_id uuid;
  v_payload jsonb;
  v_visible boolean := false;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_effective_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_effective_role := v_context #>> '{effective,role}';
  v_actor_membership_id := (v_context #>> '{actor,membershipId}')::uuid;

  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;
  if v_task.farm_id <> (v_context ->> 'farmId')::uuid then
    raise exception 'The task is outside the operated farm.' using errcode = '42501';
  end if;

  v_visible := case
    when v_effective_role = 'owner' then v_task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared')
    when v_effective_role = 'manager' then
      v_task.visibility_scope in ('management', 'farm_shared')
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
    else
      v_task.visibility_scope = 'farm_shared'
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
  end;

  if not v_visible then
    raise exception 'The task is not visible in the selected worker context.' using errcode = '42501';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'operator_mode', true,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_actor_membership_id,
    'actor_role', 'owner',
    'effective_membership_id', v_effective_membership_id,
    'effective_role', v_effective_role,
    'effective_worker_key', v_context #>> '{effective,workerKey}',
    'effective_display_name', v_context #>> '{effective,displayName}'
  );

  return atlas.record_task_transition_v1(
    p_task_id,
    p_transition,
    p_idempotency_key,
    p_target_date,
    p_note,
    p_reason,
    p_lane_key,
    p_work_key,
    v_payload,
    p_existing_field_log_id
  );
end;
$function$;

create or replace function atlas.owner_operator_reopen_task_completion_v1(
  p_effective_membership_id uuid,
  p_task_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_task atlas.tasks%rowtype;
  v_effective_membership_id uuid;
  v_effective_role text;
  v_actor_membership_id uuid;
  v_payload jsonb;
  v_visible boolean := false;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_effective_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_effective_role := v_context #>> '{effective,role}';
  v_actor_membership_id := (v_context #>> '{actor,membershipId}')::uuid;

  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;
  if v_task.farm_id <> (v_context ->> 'farmId')::uuid then
    raise exception 'The task is outside the operated farm.' using errcode = '42501';
  end if;

  v_visible := case
    when v_effective_role = 'owner' then v_task.visibility_scope in ('owner', 'management', 'assigned_worker', 'farm_shared')
    when v_effective_role = 'manager' then
      v_task.visibility_scope in ('management', 'farm_shared')
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
    else
      v_task.visibility_scope = 'farm_shared'
      or (v_task.visibility_scope = 'assigned_worker' and v_task.assigned_membership_id = v_effective_membership_id)
  end;

  if not v_visible then
    raise exception 'The task is not visible in the selected worker context.' using errcode = '42501';
  end if;

  v_payload := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
    'operator_mode', true,
    'actor_user_id', auth.uid(),
    'actor_membership_id', v_actor_membership_id,
    'actor_role', 'owner',
    'effective_membership_id', v_effective_membership_id,
    'effective_role', v_effective_role,
    'effective_worker_key', v_context #>> '{effective,workerKey}',
    'effective_display_name', v_context #>> '{effective,displayName}'
  );

  return atlas.reopen_task_completion_v1_internal(
    p_task_id,
    p_idempotency_key,
    v_payload
  );
end;
$function$;

revoke all on function atlas.owner_operator_context_v1(uuid) from public;
revoke all on function atlas.owner_operator_home_task_cards_v1(uuid, date, date) from public;
revoke all on function atlas.owner_operator_task_cards_v1(uuid, uuid) from public;
revoke all on function atlas.owner_operator_universal_home_v1(uuid, uuid, uuid, date, date) from public;
revoke all on function atlas.owner_operator_record_task_transition_v1(uuid, uuid, text, text, date, text, text, text, text, jsonb, uuid) from public;
revoke all on function atlas.owner_operator_reopen_task_completion_v1(uuid, uuid, text, jsonb) from public;

grant execute on function atlas.owner_operator_context_v1(uuid) to authenticated;
grant execute on function atlas.owner_operator_home_task_cards_v1(uuid, date, date) to authenticated;
grant execute on function atlas.owner_operator_task_cards_v1(uuid, uuid) to authenticated;
grant execute on function atlas.owner_operator_universal_home_v1(uuid, uuid, uuid, date, date) to authenticated;
grant execute on function atlas.owner_operator_record_task_transition_v1(uuid, uuid, text, text, date, text, text, text, text, jsonb, uuid) to authenticated;
grant execute on function atlas.owner_operator_reopen_task_completion_v1(uuid, uuid, text, jsonb) to authenticated;
