begin;

create or replace function atlas.create_object_maintenance_directive_v1(
  p_farm_id uuid,
  p_object_key text,
  p_maintenance_kind text,
  p_directive_kind text,
  p_title text,
  p_instructions text,
  p_assigned_membership_id uuid,
  p_due_date date,
  p_work_window_key text,
  p_effect_policy text,
  p_target_condition text,
  p_crop_cycle_ids uuid[],
  p_steps text[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_role text;
  v_object atlas.growing_objects%rowtype;
  v_farm atlas.farms%rowtype;
  v_assignee atlas.farm_memberships%rowtype;
  v_window jsonb;
  v_release_time time;
  v_close_time time;
  v_card_id uuid;
  v_rhythm_state atlas.rhythm_state%rowtype;
  v_task atlas.tasks%rowtype;
  v_task_id uuid;
  v_prerequisite_task_id uuid;
  v_directive_id uuid;
  v_existing_directive_id uuid;
  v_due_at timestamptz;
  v_task_result jsonb;
  v_cycle_id uuid;
  v_step text;
  v_position integer := 0;
  v_task_title text;
  v_original_due date;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  v_role := atlas.current_farm_role(p_farm_id);
  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or manager may add maintenance work.' using errcode = '42501';
  end if;

  if p_maintenance_kind not in ('weed','mow')
     or p_directive_kind not in ('instruction','prerequisite')
     or p_effect_policy not in ('bring_forward_only','target_condition','full_maintenance','inspection_only') then
    raise exception 'Choose a valid maintenance card, work type, and clock effect.' using errcode = '22023';
  end if;

  if nullif(btrim(coalesce(p_title,'')), '') is null or length(btrim(p_title)) > 180 then
    raise exception 'A title of 180 characters or fewer is required.' using errcode = '22023';
  end if;
  if length(coalesce(p_instructions,'')) > 3000 then
    raise exception 'Instructions must be 3000 characters or fewer.' using errcode = '22023';
  end if;
  if p_due_date is null then
    raise exception 'A due date is required.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')), '') is null or length(p_idempotency_key) > 180 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  select directive.id into v_existing_directive_id
  from atlas.maintenance_directives directive
  where directive.farm_id = p_farm_id and directive.idempotency_key = p_idempotency_key;
  if v_existing_directive_id is not null then
    return jsonb_build_object('directive', atlas.maintenance_directive_json_v1(v_existing_directive_id), 'deduplicated', true);
  end if;

  select farm.* into v_farm from atlas.farms farm where farm.id = p_farm_id;
  if v_farm.id is null then raise exception 'Farm not found.' using errcode = 'P0002'; end if;

  select object_row.* into v_object
  from atlas.growing_objects object_row
  where object_row.farm_id = p_farm_id and object_row.stable_key = btrim(p_object_key)
  limit 1;
  if v_object.id is null then raise exception 'Growing object not found.' using errcode = 'P0002'; end if;

  select membership.* into v_assignee
  from atlas.farm_memberships membership
  where membership.id = p_assigned_membership_id
    and membership.farm_id = p_farm_id
    and membership.active;
  if v_assignee.id is null then raise exception 'Choose an active member of this farm.' using errcode = '22023'; end if;

  v_window := atlas.maintenance_directive_window_v1(p_work_window_key);
  if v_window is null then raise exception 'Choose a valid work window.' using errcode = '22023'; end if;
  v_release_time := (v_window ->> 'release')::time;
  v_close_time := (v_window ->> 'close')::time;
  v_due_at := (p_due_date::timestamp + v_release_time) at time zone 'America/Chicago';

  if p_maintenance_kind = 'weed' then
    if v_object.object_type in ('room','building','structure') then
      raise exception 'This object cannot own a Weed Card.' using errcode = '22023';
    end if;
    if p_effect_policy = 'target_condition'
       and p_target_condition not in ('row_readable','mostly_clear','clear') then
      raise exception 'Choose a valid Weed Card target condition.' using errcode = '22023';
    end if;

    v_card_id := atlas.ensure_weed_card_for_object_v1(v_object.id, null);

    select task.* into v_task
    from atlas.tasks task
    join atlas.task_objects object_link on object_link.task_id = task.id and object_link.object_id = v_object.id
    where task.farm_id = p_farm_id
      and task.status in ('open','blocked')
      and (
        task.metadata ->> 'weed_card_id' = v_card_id::text
        or task.action_key = 'weed'
        or task.metadata ->> 'work_route' = 'weed'
      )
    order by task.due_date nulls last, task.created_at
    limit 1
    for update of task;

    if v_task.id is null then
      v_task_title := 'Weed ' || v_object.label;
      insert into atlas.tasks(
        organization_id, farm_id, zone_id, title, task_type, status, priority, due_date,
        note, metadata, action_key, work_class, visibility_scope, assigned_membership_id,
        assigned_user_id, created_by_user_id, origin_kind, task_scope, released_at, release_reason
      ) values (
        v_farm.organization_id, p_farm_id, v_object.zone_id, v_task_title, 'maintenance', 'open', 'normal', p_due_date,
        null,
        jsonb_build_object(
          'weed_card_id', v_card_id,
          'weed_card_managed', true,
          'weed_card_session_task', true,
          'persistent_weed_card', true,
          'work_route', 'weed',
          'work_rhythm', 'Weeding',
          'display_action', 'Weed',
          'display_subject', v_object.label,
          'manual_maintenance_serving', true
        ),
        'weed', 'standard', 'assigned_worker', v_assignee.id,
        v_assignee.user_id, auth.uid(), 'owner_assigned', 'farm_operation', now(), 'manual_maintenance_directive'
      ) returning * into v_task;

      insert into atlas.task_objects(task_id, object_id, role)
      values (v_task.id, v_object.id, 'target')
      on conflict (task_id, object_id) do nothing;

      perform atlas.ensure_weed_card_for_object_v1(v_object.id, v_task.id);
    else
      v_original_due := v_task.due_date;
      update atlas.tasks
      set due_date = least(coalesce(due_date, p_due_date), p_due_date),
          assigned_membership_id = v_assignee.id,
          assigned_user_id = v_assignee.user_id,
          visibility_scope = 'assigned_worker',
          metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
            'weed_card_id', v_card_id,
            'weed_card_managed', true,
            'weed_card_session_task', true,
            'persistent_weed_card', true,
            'manual_directive_brought_forward', true
          ),
          updated_at = now()
      where id = v_task.id
      returning * into v_task;
    end if;

    v_task_id := v_task.id;
  else
    if p_effect_policy = 'target_condition' then
      raise exception 'Mowing directives use bring-forward, full-maintenance, or inspection effects.' using errcode = '22023';
    end if;

    select state.* into v_rhythm_state
    from atlas.rhythm_state state
    where state.farm_id = p_farm_id
      and state.rhythm_key = 'mowing'
      and state.subject_kind = 'growing_object'
      and state.subject_id = v_object.id
    order by state.updated_at desc
    limit 1
    for update;

    if v_rhythm_state.id is null then
      raise exception 'This object does not have a governed mowing card.' using errcode = '22023';
    end if;

    v_task_result := atlas.ensure_rhythm_task_v1(v_rhythm_state.id, 'due', v_due_at);
    v_task_id := nullif(v_task_result ->> 'taskId','')::uuid;
    if v_task_id is null then
      raise exception 'Atlas could not release the mowing card for this date.' using errcode = '55000';
    end if;

    select task.* into v_task from atlas.tasks task where task.id = v_task_id for update;
    v_original_due := v_task.due_date;
    update atlas.tasks
    set due_date = least(coalesce(due_date, p_due_date), p_due_date),
        assigned_membership_id = v_assignee.id,
        assigned_user_id = v_assignee.user_id,
        visibility_scope = 'assigned_worker',
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'manual_directive_brought_forward', true,
          'maintenance_directive_object_id', v_object.id
        ),
        updated_at = now()
    where id = v_task_id;
  end if;

  insert into atlas.task_notification_plans(
    farm_id, task_id, release_local_time, close_local_time, nudge_after_minutes,
    group_key, group_label, source, active, metadata
  ) values (
    p_farm_id, v_task_id, v_release_time, v_close_time, 60,
    'maintenance:' || p_maintenance_kind || ':' || v_object.stable_key,
    case when p_maintenance_kind = 'weed' then 'Weeding' else 'Mowing' end,
    'maintenance_directive', true,
    jsonb_build_object('object_id', v_object.id, 'work_window_key', p_work_window_key)
  )
  on conflict (task_id) do update
  set release_local_time = excluded.release_local_time,
      close_local_time = excluded.close_local_time,
      nudge_after_minutes = excluded.nudge_after_minutes,
      group_key = excluded.group_key,
      group_label = excluded.group_label,
      source = excluded.source,
      active = true,
      metadata = atlas.task_notification_plans.metadata || excluded.metadata,
      updated_at = now();

  if p_directive_kind = 'prerequisite' then
    insert into atlas.tasks(
      organization_id, farm_id, zone_id, title, task_type, status, priority, due_date,
      unlock_text, note, metadata, action_key, work_class, visibility_scope,
      assigned_membership_id, assigned_user_id, created_by_user_id, origin_kind,
      task_scope, released_at, release_reason
    ) values (
      v_farm.organization_id, p_farm_id, v_object.zone_id, btrim(p_title), 'general', 'open', 'normal', p_due_date,
      'Unlocks ' || v_task.title, nullif(btrim(coalesce(p_instructions,'')),''),
      jsonb_build_object(
        'maintenance_prerequisite', true,
        'maintenance_kind', p_maintenance_kind,
        'maintenance_object_id', v_object.id,
        'unlocks_task_id', v_task_id,
        'work_window_key', p_work_window_key
      ),
      'prepare', 'standard', 'assigned_worker', v_assignee.id, v_assignee.user_id,
      auth.uid(), 'owner_assigned', 'farm_operation', now(), 'manual_maintenance_prerequisite'
    ) returning id into v_prerequisite_task_id;

    insert into atlas.task_objects(task_id, object_id, role)
    values (v_prerequisite_task_id, v_object.id, 'target')
    on conflict (task_id, object_id) do nothing;

    update atlas.tasks
    set status = 'blocked',
        blocker_text = btrim(p_title),
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'maintenance_prerequisite_task_id', v_prerequisite_task_id,
          'maintenance_prerequisite_title', btrim(p_title)
        ),
        updated_at = now()
    where id = v_task_id;

    insert into atlas.task_notification_plans(
      farm_id, task_id, release_local_time, close_local_time, nudge_after_minutes,
      group_key, group_label, source, active, metadata
    ) values (
      p_farm_id, v_prerequisite_task_id, v_release_time, v_close_time, 60,
      'maintenance-prerequisite:' || v_object.stable_key,
      'Preparation', 'maintenance_directive', true,
      jsonb_build_object('object_id', v_object.id, 'work_window_key', p_work_window_key)
    )
    on conflict (task_id) do update
    set release_local_time = excluded.release_local_time,
        close_local_time = excluded.close_local_time,
        nudge_after_minutes = excluded.nudge_after_minutes,
        group_key = excluded.group_key,
        group_label = excluded.group_label,
        source = excluded.source,
        active = true,
        metadata = atlas.task_notification_plans.metadata || excluded.metadata,
        updated_at = now();
  end if;

  insert into atlas.maintenance_directives(
    organization_id, farm_id, object_id, maintenance_kind, weed_card_id, rhythm_state_id,
    directive_kind, title, instructions, effect_policy, target_condition,
    assigned_membership_id, due_date, work_window_key, release_local_time,
    close_local_time, serving_task_id, prerequisite_task_id, original_task_due_date,
    idempotency_key, created_by_user_id, metadata
  ) values (
    v_farm.organization_id, p_farm_id, v_object.id, p_maintenance_kind,
    case when p_maintenance_kind='weed' then v_card_id end,
    case when p_maintenance_kind='mow' then v_rhythm_state.id end,
    p_directive_kind, btrim(p_title), nullif(btrim(coalesce(p_instructions,'')),''),
    p_effect_policy, nullif(btrim(coalesce(p_target_condition,'')),''),
    v_assignee.id, p_due_date, p_work_window_key, v_release_time, v_close_time,
    v_task_id, v_prerequisite_task_id, v_original_due, p_idempotency_key, auth.uid(),
    jsonb_build_object(
      'object_key', v_object.stable_key,
      'created_role', v_role,
      'window_label', v_window ->> 'label'
    )
  ) returning id into v_directive_id;

  update atlas.tasks
  set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'active_maintenance_directive_id', v_directive_id,
        'active_maintenance_directive_title', btrim(p_title),
        'maintenance_effect_policy', p_effect_policy,
        'maintenance_target_condition', nullif(btrim(coalesce(p_target_condition,'')),'')
      ),
      updated_at = now()
  where id = v_task_id;

  if v_prerequisite_task_id is not null then
    update atlas.tasks
    set metadata = metadata || jsonb_build_object('maintenance_directive_id', v_directive_id)
    where id = v_prerequisite_task_id;
  end if;

  foreach v_step in array coalesce(p_steps, array[]::text[]) loop
    if nullif(btrim(v_step),'') is not null then
      v_position := v_position + 1;
      if v_position > 20 then exit; end if;
      insert into atlas.maintenance_directive_steps(directive_id, position, title)
      values (v_directive_id, v_position, left(btrim(v_step), 240));
    end if;
  end loop;

  foreach v_cycle_id in array coalesce(p_crop_cycle_ids, array[]::uuid[]) loop
    if exists (
      select 1 from atlas.crop_cycles cycle
      where cycle.id = v_cycle_id and cycle.farm_id = p_farm_id and cycle.object_id = v_object.id
    ) then
      insert into atlas.maintenance_directive_crop_cycles(directive_id, crop_cycle_id, role)
      values (v_directive_id, v_cycle_id, case when p_directive_kind='prerequisite' then 'prerequisite' else 'affects' end)
      on conflict do nothing;

      insert into atlas.task_crop_cycles(task_id, crop_cycle_id, role, confidence, source, metadata)
      values (
        coalesce(v_prerequisite_task_id, v_task_id), v_cycle_id,
        case when p_directive_kind='prerequisite' then 'prerequisite' else 'affects' end,
        'confirmed', 'maintenance_directive', jsonb_build_object('maintenance_directive_id', v_directive_id)
      )
      on conflict (task_id, crop_cycle_id, role) do update
      set confidence='confirmed', source='maintenance_directive',
          metadata=atlas.task_crop_cycles.metadata || excluded.metadata;
    end if;
  end loop;

  return jsonb_build_object(
    'directive', atlas.maintenance_directive_json_v1(v_directive_id),
    'servingTaskId', v_task_id,
    'prerequisiteTaskId', v_prerequisite_task_id,
    'deduplicated', false
  );
end;
$function$;

create or replace function atlas.set_maintenance_directive_step_v1(
  p_step_id uuid,
  p_completed boolean
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_step atlas.maintenance_directive_steps%rowtype;
  v_directive atlas.maintenance_directives%rowtype;
  v_role text;
  v_membership_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;

  select step.* into v_step
  from atlas.maintenance_directive_steps step
  where step.id = p_step_id
  for update;
  if v_step.id is null then raise exception 'Maintenance checklist step not found.' using errcode='P0002'; end if;

  select * into v_directive
  from atlas.maintenance_directives
  where id = v_step.directive_id;
  if v_directive.id is null then raise exception 'Maintenance instruction not found.' using errcode='P0002'; end if;

  v_role := atlas.current_farm_role(v_directive.farm_id);
  v_membership_id := atlas.current_membership_id(v_directive.farm_id);
  if v_role is null or v_membership_id is null then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if v_role not in ('owner','manager')
     and v_membership_id <> v_directive.assigned_membership_id then
    raise exception 'This checklist belongs to another player.' using errcode='42501';
  end if;
  if v_directive.status <> 'active' then
    raise exception 'This maintenance instruction is no longer active.' using errcode='22023';
  end if;

  update atlas.maintenance_directive_steps
  set completed_at = case when p_completed then now() else null end,
      completed_by_user_id = case when p_completed then auth.uid() else null end,
      metadata = metadata || jsonb_build_object('lastChangedAt',now()),
      title = title
  where id = v_step.id;

  return atlas.maintenance_directive_json_v1(v_directive.id);
end;
$function$;

create or replace function atlas.cancel_maintenance_directive_v1(
  p_directive_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_directive atlas.maintenance_directives%rowtype;
  v_role text;
begin
  select * into v_directive
  from atlas.maintenance_directives
  where id = p_directive_id
  for update;
  if v_directive.id is null then raise exception 'Maintenance instruction not found.' using errcode='P0002'; end if;

  v_role := atlas.current_farm_role(v_directive.farm_id);
  if auth.uid() is null or v_role not in ('owner','manager') then
    raise exception 'Only an Owner or manager may cancel maintenance work.' using errcode='42501';
  end if;

  if v_directive.status = 'active' then
    update atlas.maintenance_directives
    set status='cancelled', completed_at=now(), completed_by_user_id=auth.uid(),
        completion_payload=jsonb_build_object('reason',nullif(btrim(coalesce(p_reason,'')),''),'kind','cancelled'),
        updated_at=now()
    where id=v_directive.id;

    update atlas.tasks
    set metadata = metadata
          - 'active_maintenance_directive_id'
          - 'active_maintenance_directive_title'
          - 'maintenance_effect_policy'
          - 'maintenance_target_condition',
        updated_at = now()
    where id = v_directive.serving_task_id
      and metadata ->> 'active_maintenance_directive_id' = v_directive.id::text;

    if v_directive.prerequisite_task_id is not null then
      update atlas.tasks
      set status='archived', updated_at=now(), metadata=metadata||jsonb_build_object('maintenance_directive_cancelled',true)
      where id=v_directive.prerequisite_task_id and status in ('open','blocked');

      update atlas.tasks
      set status='open', blocker_text=null,
          metadata=(metadata - 'maintenance_prerequisite_task_id' - 'maintenance_prerequisite_title')
            || jsonb_build_object('maintenance_directive_cancelled',true),
          updated_at=now()
      where id=v_directive.serving_task_id and status='blocked'
        and metadata->>'maintenance_prerequisite_task_id'=v_directive.prerequisite_task_id::text;
    end if;
  end if;

  return atlas.maintenance_directive_json_v1(v_directive.id);
end;
$function$;

commit;
