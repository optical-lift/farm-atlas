begin;

create or replace function atlas.home_task_selection_for_membership_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
)
returns table(
  task_id uuid,
  surface_group integer,
  lane_order integer,
  selection_rank bigint
)
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
  select membership.role, membership.user_id, nullif(lower(btrim(membership.worker_key)), '')
  into v_role, v_user_id, v_worker_key
  from atlas.farm_memberships membership
  where membership.id = p_membership_id
    and membership.farm_id = p_farm_id
    and membership.active = true;

  if v_role is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  if v_user_id is distinct from auth.uid()
     and not atlas.is_farm_manager_or_owner(p_farm_id) then
    raise exception 'Only farm management may read another member''s work.' using errcode='42501';
  end if;

  return query
  with personal_presented as (
    select
      presented.task_id,
      0::integer as surface_group,
      presented.lane_order::integer,
      presented.selection_rank::bigint
    from atlas.presented_work_selection_rows_v1(p_farm_id, p_membership_id, v_day) presented
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
  ),
  personal_carry as (
    select
      carry.task_id,
      1::integer as surface_group,
      1::integer as lane_order,
      row_number() over (order by task.due_date nulls last, task.priority, task.created_at)::bigint as selection_rank
    from atlas.member_day_carryover_v1(p_farm_id, p_membership_id, v_day) carry
    join atlas.tasks task on task.id = carry.task_id
  ),
  personal_scheduled as (
    select
      task.id as task_id,
      2::integer as surface_group,
      1::integer as lane_order,
      row_number() over (order by task.due_date, task.priority, task.created_at)::bigint as selection_rank
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
  ),
  alongside as (
    select
      task.id as task_id,
      3::integer as surface_group,
      1::integer as lane_order,
      row_number() over (order by task.due_date, task.priority, task.created_at)::bigint as selection_rank
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
  ),
  completed_today as (
    select
      task.id as task_id,
      4::integer as surface_group,
      1::integer as lane_order,
      row_number() over (order by task.completed_at, task.created_at, task.id)::bigint as selection_rank
    from atlas.tasks task
    where p_done_date is not null
      and task.farm_id = p_farm_id
      and task.assigned_membership_id = p_membership_id
      and task.parent_task_id is null
      and task.status = 'done'
      and task.completed_at is not null
      and (task.completed_at at time zone 'America/Chicago')::date = p_done_date
  ),
  chosen as (
    select * from personal_presented
    union all select * from personal_carry
    union all select * from personal_scheduled
    union all select * from alongside
    union all select * from completed_today
  ),
  deduped as (
    select distinct on (chosen.task_id)
      chosen.task_id,
      chosen.surface_group,
      chosen.lane_order,
      chosen.selection_rank
    from chosen
    order by chosen.task_id, chosen.surface_group, chosen.lane_order, chosen.selection_rank
  )
  select
    selected.task_id,
    selected.surface_group,
    selected.lane_order,
    selected.selection_rank
  from deduped selected
  join atlas.tasks task on task.id = selected.task_id
  where task.status in ('open', 'blocked', 'done')
    and not (v_role = 'farm_hand' and task.status = 'blocked')
  order by selected.surface_group, selected.lane_order, selected.selection_rank;
end;
$function$;

revoke all on function atlas.home_task_selection_for_membership_v1(uuid,uuid,date,date) from public, anon, authenticated;
grant execute on function atlas.home_task_selection_for_membership_v1(uuid,uuid,date,date) to service_role;

create or replace function atlas.owner_operator_home_task_cards_lite_v1(
  p_effective_membership_id uuid,
  p_due_through date default null,
  p_done_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
declare
  v_context jsonb;
  v_farm_id uuid;
  v_membership_id uuid;
  v_cards jsonb := '[]'::jsonb;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;

  select coalesce(jsonb_agg(card.card order by card.due_date nulls last, card.created_at, card.task_id), '[]'::jsonb)
  into v_cards
  from (
    select
      task.id as task_id,
      task.due_date,
      task.created_at,
      jsonb_build_object(
        'farm_key', farm.stable_key,
        'task_id', task.id,
        'title', task.title,
        'task_type', task.task_type,
        'status', task.status,
        'priority', task.priority,
        'due_date', task.due_date,
        'unlock_text', task.unlock_text,
        'blocker_text', task.blocker_text,
        'note', task.note,
        'generated_from', task.generated_from,
        'generated_from_id', task.generated_from_id,
        'action_key', task.action_key,
        'work_class', task.work_class,
        'operation_class', task.operation_class,
        'operation_class_source', task.operation_class_source,
        'parent_task_id', task.parent_task_id,
        'task_series_key', task.task_series_key,
        'engine_instance_key', task.engine_instance_key,
        'created_at', task.created_at,
        'updated_at', task.updated_at,
        'metadata', coalesce(task.metadata, '{}'::jsonb)
          - 'effort_units' - 'effort_band' - 'estimated_minutes' - 'duration_minutes'
          - 'timeboxed_minutes' - 'packet_target_hours' - 'packet_day_target_hours'
          - 'capacity_blocked' - 'capacity_blocker' - 'capacity_observed_date'
          - 'dependency_delay_minutes',
        'zone_id', zone.id,
        'zone_key', zone.stable_key,
        'zone_label', zone.label,
        'assigned_membership_id', task.assigned_membership_id,
        'assigned_user_id', task.assigned_user_id,
        'objects', coalesce(objects.items, '[]'::jsonb),
        'resource_requirements', coalesce(requirements.items, '[]'::jsonb),
        'action_templates', coalesce(templates.items, '[]'::jsonb),
        'task_logs', '[]'::jsonb,
        'task_outcomes', coalesce(outcome.items, '[]'::jsonb),
        'task_transitions', '[]'::jsonb
      ) as card
    from atlas.home_task_selection_for_membership_v1(
      v_farm_id,
      v_membership_id,
      p_due_through,
      p_done_date
    ) selected
    join atlas.tasks task on task.id = selected.task_id
    join atlas.farms farm on farm.id = task.farm_id
    left join atlas.zones zone on zone.id = task.zone_id
    left join lateral (
      select jsonb_agg(item order by role, object_label, object_id) as items
      from (
        select jsonb_build_object(
          'object_id', growing.id,
          'role', link.role,
          'object_key', growing.stable_key,
          'object_label', growing.label,
          'object_type', growing.object_type,
          'object_mode', growing.object_mode,
          'life_status', state.life_status,
          'weed_pressure', state.weed_pressure,
          'water_status', state.water_status,
          'last_touched_at', state.last_touched_at,
          'last_weeded_at', state.last_weeded_at,
          'last_watered_at', state.last_watered_at,
          'last_checked_at', state.last_checked_at,
          'decision_required', state.decision_required,
          'presentability', state.presentability,
          'state_metadata', state.metadata
        ) as item,
        link.role,
        growing.label as object_label,
        growing.id as object_id
        from atlas.task_objects link
        join atlas.growing_objects growing on growing.id = link.object_id
        left join atlas.object_state state on state.object_id = growing.id
        where link.task_id = task.id
      ) object_rows
    ) objects on true
    left join lateral (
      select jsonb_agg(item order by requirement_id) as items
      from (
        select
          requirement.id as requirement_id,
          jsonb_build_object(
            'requirement_id', requirement.id,
            'requirement_role', requirement.requirement_role,
            'move_role', requirement.move_role,
            'requirement_source', requirement.requirement_source,
            'quantity_needed', requirement.quantity_needed,
            'unit', requirement.unit,
            'status', requirement.status,
            'note', requirement.note,
            'resource_key', resource.stable_key,
            'resource_label', resource.label,
            'resource_type', resource.resource_type,
            'resource_category', resource.resource_category,
            'resource_status', resource.status,
            'resource_quantity', resource.quantity,
            'resource_unit', resource.unit,
            'condition_notes', resource.condition_notes,
            'restock_needed', resource.restock_needed
          ) as item
        from atlas.task_resource_requirements requirement
        left join atlas.resources resource on resource.id = requirement.resource_id
        where requirement.task_id = task.id
      ) requirement_rows
    ) requirements on true
    left join lateral (
      select jsonb_agg(item order by template_id) as items
      from (
        select distinct on (template.id)
          template.id as template_id,
          jsonb_build_object(
            'template_id', template.id,
            'template_key', template.stable_key,
            'template_label', template.label,
            'action_type', template.action_type,
            'required_resource_categories', template.required_resource_categories,
            'optional_resource_categories', template.optional_resource_categories,
            'required_resource_keys', template.required_resource_keys,
            'optional_resource_keys', template.optional_resource_keys,
            'creates_follow_up_task_types', template.creates_follow_up_task_types,
            'hard_parts', template.hard_parts,
            'unlocks', template.unlocks,
            'card_language', template.metadata ->> 'card_language'
          ) as item
        from atlas.task_resource_requirements requirement
        join atlas.action_requirement_templates template on template.id = requirement.template_id
        where requirement.task_id = task.id
        order by template.id
      ) template_rows
    ) templates on true
    left join lateral (
      select jsonb_agg(item order by created_at desc, event_id desc) as items
      from (
        select
          event.id as event_id,
          event.created_at,
          jsonb_build_object(
            'event_id', event.id,
            'outcome', event.outcome,
            'lane_key', event.lane_key,
            'work_key', event.work_key,
            'blocker_reason', event.blocker_reason,
            'note', event.note,
            'created_at', event.created_at
          ) as item
        from atlas.task_outcome_events event
        where event.task_id = task.id
        order by event.created_at desc, event.id desc
        limit 1
      ) outcome_rows
    ) outcome on true
  ) card;

  return v_cards;
end;
$function$;

revoke all on function atlas.owner_operator_home_task_cards_lite_v1(uuid,date,date) from public, anon, authenticated;
grant execute on function atlas.owner_operator_home_task_cards_lite_v1(uuid,date,date) to service_role;

create or replace function atlas.owner_operator_universal_home_fast_v1(
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
  v_actor_user_id uuid;
  v_farm_id uuid;
  v_membership_id uuid;
  v_role text;
  v_worker_key text;
  v_permissions jsonb;
  v_farm_key text;
  v_farm_name text;
  v_farm_status text;
  v_farm_organization_id uuid;
  v_snapshot jsonb := '{}'::jsonb;
  v_cards jsonb := '[]'::jsonb;
  v_open_count integer := 0;
  v_blocked_count integer := 0;
  v_overdue_count integer := 0;
  v_due_today_count integer := 0;
  v_last_movement_at timestamptz;
  v_target_farm jsonb;
begin
  v_context := atlas.owner_operator_context_v1(p_effective_membership_id);
  v_actor_user_id := (v_context #>> '{actor,userId}')::uuid;
  v_farm_id := (v_context ->> 'farmId')::uuid;
  v_membership_id := (v_context #>> '{effective,membershipId}')::uuid;
  v_role := v_context #>> '{effective,role}';
  v_worker_key := v_context #>> '{effective,workerKey}';
  v_permissions := coalesce(v_context #> '{effective,permissions}', '{}'::jsonb);

  select farm.stable_key, farm.name, farm.status, farm.organization_id
  into v_farm_key, v_farm_name, v_farm_status, v_farm_organization_id
  from atlas.farms farm
  where farm.id = v_farm_id
    and farm.status = 'active';

  if v_farm_key is null then
    raise exception 'The owner farm could not be loaded for operator mode.' using errcode='42501';
  end if;

  v_snapshot := coalesce(atlas.farm_snapshot_for_member_v1(v_farm_id), '{}'::jsonb);
  v_cards := coalesce(atlas.owner_operator_home_task_cards_lite_v1(
    v_membership_id,
    p_due_through,
    p_done_date
  ), '[]'::jsonb);

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

  select greatest(
    (select max(task.updated_at) from atlas.tasks task where task.farm_id = v_farm_id),
    (select max(log.updated_at) from atlas.field_logs log where log.farm_id = v_farm_id),
    (select max(event.created_at) from atlas.object_activity_events event where event.farm_id = v_farm_id)
  )
  into v_last_movement_at;

  v_target_farm := jsonb_build_object(
    'membershipId', v_membership_id,
    'farmId', v_farm_id,
    'farmKey', v_farm_key,
    'farmName', v_farm_name,
    'farmStatus', v_farm_status,
    'organizationId', v_farm_organization_id,
    'role', v_role,
    'workerKey', v_worker_key,
    'permissions', v_permissions,
    'canManageFarm', v_role in ('owner', 'manager'),
    'canUseOwnerTools', v_role = 'owner',
    'snapshot', v_snapshot,
    'taskCards', v_cards,
    'openTaskCount', coalesce(v_open_count, 0),
    'blockedTaskCount', coalesce(v_blocked_count, 0),
    'overdueTaskCount', coalesce(v_overdue_count, 0),
    'dueTodayCount', coalesce(v_due_today_count, 0),
    'lastMovementAt', v_last_movement_at
  );

  return jsonb_build_object(
    'viewer', jsonb_build_object(
      'userId', v_actor_user_id,
      'activeFarmId', v_farm_id,
      'organizationId', null,
      'organizationRole', null,
      'hasOrganizationScope', false,
      'hasFarmScope', true
    ),
    'organizationHome', 'null'::jsonb,
    'projectTasks', '[]'::jsonb,
    'farms', jsonb_build_array(v_target_farm),
    'window', jsonb_build_object(
      'doneDate', p_done_date,
      'dueThrough', p_due_through
    ),
    'operatorContext', v_context
  );
end;
$function$;

revoke all on function atlas.owner_operator_universal_home_fast_v1(uuid,uuid,uuid,date,date) from public, anon, authenticated;
grant execute on function atlas.owner_operator_universal_home_fast_v1(uuid,uuid,uuid,date,date) to service_role;

commit;
