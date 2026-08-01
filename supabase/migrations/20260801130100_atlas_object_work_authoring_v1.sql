begin;

create or replace function atlas.create_object_work_v1(
  p_farm_id uuid,
  p_object_key text,
  p_action_kind text,
  p_title text,
  p_instructions text,
  p_done_definition text,
  p_unlock_text text,
  p_effort_class text,
  p_assigned_membership_id uuid,
  p_due_date date,
  p_work_window_key text,
  p_release_mode text,
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
  v_action jsonb;
  v_release_time time;
  v_close_time time;
  v_today date;
  v_item_id uuid;
  v_existing_id uuid;
  v_occurrence_id uuid;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_task_id uuid;
  v_task atlas.tasks%rowtype;
  v_cycle_id uuid;
  v_step text;
  v_position integer := 0;
  v_relation_payload jsonb;
  v_task_payload jsonb;
  v_crop_payload jsonb;
  v_active_top integer;
  v_member_active integer;
  v_settings atlas.farm_task_release_settings%rowtype;
  v_capacity_snapshot jsonb;
  v_task_type text;
  v_action_key text;
  v_route text;
  v_action_label text;
begin
  if auth.uid() is null then
    raise exception 'Sign in required.' using errcode = '42501';
  end if;

  v_role := atlas.current_farm_role(p_farm_id);
  if v_role not in ('owner','manager') then
    raise exception 'Only an Owner or manager may create work from a place.' using errcode = '42501';
  end if;

  if p_action_kind in ('weed','mow') then
    raise exception 'Weeding and mowing belong to their persistent maintenance cards.' using errcode = '22023';
  end if;
  v_action := atlas.object_work_action_contract_v1(p_action_kind);
  if v_action is null then
    raise exception 'Choose a supported kind of work.' using errcode = '22023';
  end if;
  if p_release_mode not in ('put_in_work','hold_for_capacity') then
    raise exception 'Choose whether to put the card in Work or hold it as planned.' using errcode = '22023';
  end if;
  if p_effort_class not in ('light','standard','heavy') then
    raise exception 'Choose a valid effort size.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_title,'')),'') is null or length(btrim(p_title)) > 180 then
    raise exception 'A title of 180 characters or fewer is required.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_done_definition,'')),'') is null or length(btrim(p_done_definition)) > 600 then
    raise exception 'A physical done definition of 600 characters or fewer is required.' using errcode = '22023';
  end if;
  if length(coalesce(p_instructions,'')) > 3000 or length(coalesce(p_unlock_text,'')) > 600 then
    raise exception 'Instructions or consequence text is too long.' using errcode = '22023';
  end if;
  if cardinality(coalesce(p_steps,array[]::text[])) > 20 or cardinality(coalesce(p_crop_cycle_ids,array[]::uuid[])) > 20 then
    raise exception 'Use no more than 20 checklist steps or crop links.' using errcode = '22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null or length(p_idempotency_key) > 180 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  select item.id into v_existing_id
  from atlas.object_work_items item
  where item.farm_id = p_farm_id and item.idempotency_key = p_idempotency_key;
  if v_existing_id is not null then
    return jsonb_build_object('workItem', atlas.object_work_item_json_v1(v_existing_id), 'deduplicated', true);
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

  insert into atlas.farm_task_release_settings(farm_id)
  values (p_farm_id)
  on conflict (farm_id) do nothing;
  select * into v_settings from atlas.farm_task_release_settings where farm_id = p_farm_id;
  v_today := (now() at time zone v_settings.timezone_name)::date;
  if p_due_date is null or p_due_date < v_today or p_due_date > v_today + 180 then
    raise exception 'Choose a farm day from today through the next 180 days.' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(coalesce(p_crop_cycle_ids,array[]::uuid[])) cycle_id
    where not exists (
      select 1 from atlas.crop_cycles cycle
      where cycle.id = cycle_id and cycle.farm_id = p_farm_id and cycle.object_id = v_object.id
    )
  ) then
    raise exception 'Every selected crop must belong to this place.' using errcode = '22023';
  end if;

  select count(*)::integer into v_active_top
  from atlas.tasks task
  where task.farm_id = p_farm_id and task.status in ('open','blocked') and task.parent_task_id is null;
  select count(*)::integer into v_member_active
  from atlas.tasks task
  where task.farm_id = p_farm_id and task.status in ('open','blocked') and task.assigned_membership_id = v_assignee.id;
  v_capacity_snapshot := jsonb_build_object(
    'activeTopLevel', v_active_top,
    'maximumTopLevel', v_settings.maximum_active_top_level_tasks,
    'assignedMemberActive', v_member_active,
    'maximumPerMember', v_settings.maximum_active_tasks_per_member,
    'farmAtCapacity', v_active_top >= v_settings.maximum_active_top_level_tasks,
    'memberAtCapacity', v_member_active >= v_settings.maximum_active_tasks_per_member
  );

  v_task_type := v_action ->> 'taskType';
  v_action_key := v_action ->> 'actionKey';
  v_route := v_action ->> 'route';
  v_action_label := v_action ->> 'label';

  insert into atlas.object_work_items(
    organization_id, farm_id, object_id, action_kind, title, instructions,
    done_definition, unlock_text, effort_class, assigned_membership_id,
    due_date, work_window_key, release_local_time, close_local_time,
    release_mode, status, idempotency_key, created_by_user_id, metadata
  ) values (
    v_farm.organization_id, p_farm_id, v_object.id, p_action_kind, btrim(p_title),
    nullif(btrim(coalesce(p_instructions,'')),''), btrim(p_done_definition),
    nullif(btrim(coalesce(p_unlock_text,'')),''), p_effort_class, v_assignee.id,
    p_due_date, p_work_window_key, v_release_time, v_close_time,
    p_release_mode, 'planned', p_idempotency_key, auth.uid(),
    jsonb_build_object(
      'createdRole', v_role,
      'objectKey', v_object.stable_key,
      'windowLabel', v_window ->> 'label',
      'capacityAtAuthoring', v_capacity_snapshot
    )
  ) returning id into v_item_id;

  foreach v_step in array coalesce(p_steps,array[]::text[]) loop
    if nullif(btrim(v_step),'') is not null then
      v_position := v_position + 1;
      insert into atlas.object_work_steps(work_item_id, position, title)
      values (v_item_id, v_position, left(btrim(v_step),240));
    end if;
  end loop;

  foreach v_cycle_id in array coalesce(p_crop_cycle_ids,array[]::uuid[]) loop
    insert into atlas.object_work_crop_cycles(work_item_id, crop_cycle_id, role)
    values (
      v_item_id,
      v_cycle_id,
      case p_action_kind when 'harvest' then 'harvests' when 'check' then 'observes' else 'affects' end
    )
    on conflict do nothing;
  end loop;

  select coalesce(jsonb_agg(jsonb_build_object(
    'crop_cycle_id', cycle_id,
    'role', case p_action_kind when 'harvest' then 'harvests' when 'check' then 'observes' else 'affects' end,
    'confidence', 'confirmed',
    'source', 'object_work_authoring',
    'metadata', jsonb_build_object('object_work_item_id',v_item_id)
  )), '[]'::jsonb)
  into v_crop_payload
  from unnest(coalesce(p_crop_cycle_ids,array[]::uuid[])) cycle_id;

  v_relation_payload := jsonb_build_object(
    'task_objects', jsonb_build_array(jsonb_build_object('object_id',v_object.id,'role','target')),
    'task_crop_cycles', v_crop_payload
  );

  v_task_payload := jsonb_build_object(
    'organization_id', v_farm.organization_id,
    'zone_id', v_object.zone_id,
    'title', btrim(p_title),
    'task_type', v_task_type,
    'priority', case when p_effort_class='heavy' then 'high' else 'normal' end,
    'due_date', p_due_date,
    'unlock_text', nullif(btrim(coalesce(p_unlock_text,'')),''),
    'note', null,
    'metadata', jsonb_build_object(
      'object_work_item_id', v_item_id,
      'manual_object_work', true,
      'display_title', v_action_label || ' · ' || btrim(p_title),
      'display_action', v_action_label,
      'display_subject', btrim(p_title),
      'display_instruction', coalesce(nullif(btrim(coalesce(p_instructions,'')),''), btrim(p_title)),
      'done_definition', btrim(p_done_definition),
      'work_route', v_route,
      'work_window_key', p_work_window_key,
      'object_id', v_object.id,
      'object_key', v_object.stable_key,
      'object_label', v_object.label,
      'release_mode', p_release_mode,
      'capacity_at_authoring', v_capacity_snapshot
    ),
    'action_key', v_action_key,
    'work_class', p_effort_class,
    'visibility_scope', 'assigned_worker',
    'assigned_membership_id', v_assignee.id,
    'assigned_user_id', v_assignee.user_id,
    'created_by_user_id', auth.uid(),
    'origin_kind', 'owner_assigned',
    'task_scope', 'farm_operation'
  );

  v_occurrence_id := atlas.plan_work_occurrence_v1(
    p_farm_id,
    'object-work:' || v_object.stable_key || ':' || p_action_kind,
    'object-work:' || v_object.stable_key || ':' || p_action_kind || ':manual',
    'object-work:' || v_item_id::text,
    btrim(p_title),
    v_task_type,
    p_due_date,
    'object_work_item',
    v_item_id,
    'immediate',
    180,
    10,
    v_task_payload,
    v_relation_payload,
    jsonb_build_object('manualAuthoring',true,'releaseMode',p_release_mode),
    p_due_date,
    jsonb_build_object('object_work_item_id',v_item_id,'capacityAtAuthoring',v_capacity_snapshot)
  );

  update atlas.object_work_items
  set planned_occurrence_id = v_occurrence_id, updated_at = now()
  where id = v_item_id;

  if p_release_mode = 'put_in_work' then
    select * into v_occurrence
    from atlas.planned_work_occurrences occurrence
    where occurrence.id = v_occurrence_id
    for update;

    insert into atlas.tasks(
      organization_id, farm_id, zone_id, title, task_type, status, priority, due_date,
      unlock_text, note, metadata, action_key, work_class, visibility_scope,
      assigned_membership_id, assigned_user_id, created_by_user_id, origin_kind,
      task_scope, planned_occurrence_id, release_policy_id, released_at, release_reason
    ) values (
      v_farm.organization_id, p_farm_id, v_object.zone_id, btrim(p_title), v_task_type,
      'open', case when p_effort_class='heavy' then 'high' else 'normal' end, p_due_date,
      nullif(btrim(coalesce(p_unlock_text,'')),''), null, v_task_payload -> 'metadata',
      v_action_key, p_effort_class, 'assigned_worker', v_assignee.id, v_assignee.user_id,
      auth.uid(), 'owner_assigned', 'farm_operation', v_occurrence_id,
      v_occurrence.release_policy_id, now(), 'manual_object_work_capacity_override'
    ) returning * into v_task;
    v_task_id := v_task.id;

    perform atlas.restore_task_relation_payload_v1(v_task_id, v_relation_payload);

    update atlas.planned_work_occurrences
    set state='released', gate_satisfied_at=now(), released_at=now(),
        released_task_id=v_task_id,
        metadata=metadata || jsonb_build_object('manualCapacityOverride',true),
        updated_at=now()
    where id=v_occurrence_id;

    insert into atlas.task_release_events(
      farm_id, occurrence_id, release_policy_id, task_id, release_reason, metadata
    ) values (
      p_farm_id, v_occurrence_id, v_occurrence.release_policy_id, v_task_id,
      'manual_object_work_capacity_override',
      jsonb_build_object('object_work_item_id',v_item_id,'capacityAtAuthoring',v_capacity_snapshot)
    ) on conflict (occurrence_id, task_id) do nothing;

    update atlas.object_work_items
    set status='released', task_id=v_task_id, due_date=v_task.due_date,
        metadata=metadata || jsonb_build_object('manualCapacityOverride',true),
        updated_at=now()
    where id=v_item_id;

    insert into atlas.task_notification_plans(
      farm_id, task_id, release_local_time, close_local_time, nudge_after_minutes,
      group_key, group_label, source, active, metadata
    ) values (
      p_farm_id, v_task_id, v_release_time, v_close_time, 60,
      'object-work:' || v_object.stable_key || ':' || p_action_kind,
      v_action_label, 'object_work_authoring', true,
      jsonb_build_object('object_work_item_id',v_item_id,'object_id',v_object.id,'work_window_key',p_work_window_key)
    )
    on conflict (task_id) do update
    set release_local_time=excluded.release_local_time,
        close_local_time=excluded.close_local_time,
        nudge_after_minutes=excluded.nudge_after_minutes,
        group_key=excluded.group_key,
        group_label=excluded.group_label,
        source=excluded.source,
        active=true,
        metadata=atlas.task_notification_plans.metadata || excluded.metadata,
        updated_at=now();
  end if;

  return jsonb_build_object(
    'workItem', atlas.object_work_item_json_v1(v_item_id),
    'taskId', v_task_id,
    'plannedOccurrenceId', v_occurrence_id,
    'deduplicated', false
  );
exception
  when unique_violation then
    raise exception 'Equivalent work is already active for this place, person, and day.' using errcode='23505';
end;
$function$;

create or replace function atlas.object_work_for_task_v1(p_task_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare v_item_id uuid;
begin
  if auth.uid() is null or not atlas.can_read_task_in_journal_v1(p_task_id) then
    raise exception 'Task is not visible to the signed-in account.' using errcode='42501';
  end if;
  select item.id into v_item_id from atlas.object_work_items item where item.task_id=p_task_id limit 1;
  if v_item_id is null then return null; end if;
  return atlas.object_work_item_json_v1(v_item_id);
end;
$function$;

create or replace function atlas.set_object_work_step_v1(p_step_id uuid, p_complete boolean)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_step atlas.object_work_steps%rowtype;
  v_item atlas.object_work_items%rowtype;
  v_role text;
  v_membership_id uuid;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  select * into v_step from atlas.object_work_steps where id=p_step_id for update;
  if v_step.id is null then raise exception 'Checklist step not found.' using errcode='P0002'; end if;
  select * into v_item from atlas.object_work_items where id=v_step.work_item_id;
  v_role := atlas.current_farm_role(v_item.farm_id);
  v_membership_id := atlas.current_membership_id(v_item.farm_id);
  if v_role not in ('owner','manager') and v_membership_id is distinct from v_item.assigned_membership_id then
    raise exception 'This checklist belongs to another assignment.' using errcode='42501';
  end if;
  if v_item.status <> 'released' or v_item.task_id is null or not atlas.can_read_task_in_journal_v1(v_item.task_id) then
    raise exception 'Checklist work is not currently released.' using errcode='42501';
  end if;

  update atlas.object_work_steps
  set completed_at=case when p_complete then coalesce(completed_at,now()) else null end,
      completed_by_user_id=case when p_complete then auth.uid() else null end
  where id=p_step_id;
  return atlas.object_work_item_json_v1(v_item.id);
end;
$function$;

create or replace function atlas.cancel_object_work_plan_v1(p_work_item_id uuid, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare v_item atlas.object_work_items%rowtype; v_role text;
begin
  if auth.uid() is null then raise exception 'Sign in required.' using errcode='42501'; end if;
  select * into v_item from atlas.object_work_items where id=p_work_item_id for update;
  if v_item.id is null then raise exception 'Planned work not found.' using errcode='P0002'; end if;
  v_role := atlas.current_farm_role(v_item.farm_id);
  if v_role not in ('owner','manager') then raise exception 'Only an Owner or manager may cancel planned work.' using errcode='42501'; end if;
  if v_item.status <> 'planned' or v_item.task_id is not null then
    raise exception 'Released work must be closed from its task card so the result remains canonical.' using errcode='55000';
  end if;

  update atlas.object_work_items
  set status='cancelled',
      metadata=metadata || jsonb_build_object('cancelledBy',auth.uid(),'cancelReason',nullif(btrim(coalesce(p_reason,'')),'')),
      updated_at=now()
  where id=v_item.id;
  update atlas.planned_work_occurrences
  set state='cancelled', metadata=metadata || jsonb_build_object('cancelReason',nullif(btrim(coalesce(p_reason,'')),'')), updated_at=now()
  where id=v_item.planned_occurrence_id and state not in ('released','completed');
  return atlas.object_work_item_json_v1(v_item.id);
end;
$function$;

commit;
