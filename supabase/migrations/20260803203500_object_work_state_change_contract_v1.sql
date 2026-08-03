begin;

alter table atlas.object_work_items
  add column if not exists current_truth text,
  add column if not exists after_truth text,
  add column if not exists current_truth_applied_at timestamptz,
  add column if not exists after_truth_applied_at timestamptz;

alter table atlas.object_work_items
  drop constraint if exists object_work_items_current_truth_length_check,
  add constraint object_work_items_current_truth_length_check
    check (current_truth is null or (length(btrim(current_truth)) between 1 and 600)),
  drop constraint if exists object_work_items_after_truth_length_check,
  add constraint object_work_items_after_truth_length_check
    check (after_truth is null or (length(btrim(after_truth)) between 1 and 600)),
  drop constraint if exists object_work_items_truth_change_check,
  add constraint object_work_items_truth_change_check
    check (current_truth is null or after_truth is null or btrim(current_truth) <> btrim(after_truth));

alter table atlas.object_state
  add column if not exists operational_truth text,
  add column if not exists operational_truth_source text,
  add column if not exists operational_truth_work_item_id uuid references atlas.object_work_items(id) on delete set null,
  add column if not exists operational_truth_task_id uuid references atlas.tasks(id) on delete set null,
  add column if not exists operational_truth_changed_at timestamptz;

create index if not exists object_state_operational_truth_work_item_idx
  on atlas.object_state(operational_truth_work_item_id)
  where operational_truth_work_item_id is not null;
create index if not exists object_state_operational_truth_task_idx
  on atlas.object_state(operational_truth_task_id)
  where operational_truth_task_id is not null;

create or replace function atlas.record_object_work_truth_v1(
  p_work_item_id uuid,
  p_phase text,
  p_task_id uuid default null
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_item atlas.object_work_items%rowtype;
  v_truth text;
  v_source text;
  v_event_type text;
  v_event_date date;
  v_timezone text;
begin
  select * into v_item
  from atlas.object_work_items
  where id = p_work_item_id
  for update;

  if v_item.id is null then
    raise exception 'Object work item not found.' using errcode = 'P0002';
  end if;
  if p_phase not in ('current','after') then
    raise exception 'Choose current or after truth.' using errcode = '22023';
  end if;

  v_truth := case p_phase when 'current' then v_item.current_truth else v_item.after_truth end;
  if nullif(btrim(coalesce(v_truth,'')),'') is null then return; end if;

  v_source := case p_phase when 'current' then 'object_work_current' else 'object_work_completion' end;
  v_event_type := case p_phase when 'current' then 'task_state_declared' else 'task_state_applied' end;

  select coalesce(settings.timezone_name, 'America/Chicago') into v_timezone
  from atlas.farm_task_release_settings settings
  where settings.farm_id = v_item.farm_id;
  v_event_date := (now() at time zone coalesce(v_timezone, 'America/Chicago'))::date;

  insert into atlas.object_state(
    object_id,
    farm_id,
    operational_truth,
    operational_truth_source,
    operational_truth_work_item_id,
    operational_truth_task_id,
    operational_truth_changed_at,
    last_touched_at,
    metadata
  ) values (
    v_item.object_id,
    v_item.farm_id,
    btrim(v_truth),
    v_source,
    v_item.id,
    p_task_id,
    now(),
    v_event_date,
    jsonb_build_object(
      'operationalTruthContract','object_work_state_change_v1',
      'operationalTruthPhase',p_phase
    )
  )
  on conflict (object_id) do update
  set operational_truth = excluded.operational_truth,
      operational_truth_source = excluded.operational_truth_source,
      operational_truth_work_item_id = excluded.operational_truth_work_item_id,
      operational_truth_task_id = excluded.operational_truth_task_id,
      operational_truth_changed_at = excluded.operational_truth_changed_at,
      last_touched_at = excluded.last_touched_at,
      metadata = coalesce(atlas.object_state.metadata,'{}'::jsonb) || excluded.metadata,
      updated_at = now();

  insert into atlas.object_activity_events(
    farm_id,
    object_id,
    event_type,
    event_date,
    note,
    created_by,
    source,
    idempotency_key,
    metadata
  ) values (
    v_item.farm_id,
    v_item.object_id,
    v_event_type,
    v_event_date,
    btrim(v_truth),
    'atlas',
    'object_work_state_change',
    'object-work-truth:' || v_item.id::text || ':' || p_phase,
    jsonb_build_object(
      'object_work_item_id',v_item.id,
      'task_id',p_task_id,
      'phase',p_phase,
      'current_truth',v_item.current_truth,
      'after_truth',v_item.after_truth
    )
  )
  on conflict (farm_id, idempotency_key) where idempotency_key is not null do nothing;

  update atlas.object_work_items
  set current_truth_applied_at = case when p_phase='current' then now() else current_truth_applied_at end,
      after_truth_applied_at = case when p_phase='after' then now() else after_truth_applied_at end,
      completion_payload = case when p_phase='after'
        then coalesce(completion_payload,'{}'::jsonb) || jsonb_build_object(
          'stateChangeApplied',true,
          'currentTruth',current_truth,
          'afterTruth',after_truth,
          'appliedAt',now()
        )
        else completion_payload
      end,
      updated_at = now()
  where id = v_item.id;
end;
$function$;

create or replace function atlas.object_work_item_json_v1(p_work_item_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
  select jsonb_build_object(
    'id', item.id,
    'actionKind', item.action_kind,
    'actionLabel', atlas.object_work_action_contract_v1(item.action_kind) ->> 'label',
    'title', item.title,
    'instructions', item.instructions,
    'doneDefinition', item.done_definition,
    'currentTruth', item.current_truth,
    'afterTruth', item.after_truth,
    'currentTruthAppliedAt', item.current_truth_applied_at,
    'afterTruthAppliedAt', item.after_truth_applied_at,
    'unlockText', item.unlock_text,
    'effortClass', item.effort_class,
    'effortUnits', item.effort_units,
    'dueDate', item.due_date,
    'workWindowKey', item.work_window_key,
    'releaseLocalTime', item.release_local_time,
    'closeLocalTime', item.close_local_time,
    'releaseMode', item.release_mode,
    'dateCommitment', item.date_commitment,
    'workLane', item.work_lane,
    'bringIntoWorkNow', item.bring_into_work_now,
    'status', item.status,
    'plannedOccurrenceId', item.planned_occurrence_id,
    'taskId', item.task_id,
    'assignee', jsonb_build_object(
      'membershipId', membership.id,
      'role', membership.role,
      'workerKey', membership.worker_key,
      'displayName', coalesce(profile.display_name, membership.worker_key, initcap(membership.role))
    ),
    'steps', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', step.id,
        'position', step.position,
        'title', step.title,
        'complete', step.completed_at is not null,
        'completedAt', step.completed_at
      ) order by step.position)
      from atlas.object_work_steps step
      where step.work_item_id = item.id
    ), '[]'::jsonb),
    'cropCycles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', cycle.id,
        'label', cycle.crop_label,
        'variety', cycle.variety,
        'state', cycle.cycle_state,
        'role', link.role
      ) order by cycle.crop_label, cycle.variety nulls last)
      from atlas.object_work_crop_cycles link
      join atlas.crop_cycles cycle on cycle.id = link.crop_cycle_id
      where link.work_item_id = item.id
    ), '[]'::jsonb),
    'object', jsonb_build_object(
      'id', object_row.id,
      'key', object_row.stable_key,
      'label', object_row.label,
      'type', object_row.object_type
    ),
    'createdAt', item.created_at,
    'completedAt', item.completed_at,
    'metadata', item.metadata
  )
  from atlas.object_work_items item
  join atlas.growing_objects object_row on object_row.id = item.object_id
  join atlas.farm_memberships membership on membership.id = item.assigned_membership_id
  left join atlas.user_profiles profile on profile.user_id = membership.user_id
  where item.id = p_work_item_id
$function$;

create or replace function atlas.create_object_work_v3(
  p_farm_id uuid,
  p_object_key text,
  p_action_kind text,
  p_title text,
  p_current_truth text,
  p_after_truth text,
  p_unlock_text text,
  p_effort_class text,
  p_assigned_membership_id uuid,
  p_due_date date,
  p_work_window_key text,
  p_date_commitment text,
  p_bring_into_work_now boolean,
  p_crop_cycle_ids uuid[],
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_result jsonb;
  v_item_id uuid;
  v_task_id uuid;
  v_occurrence_id uuid;
  v_transition jsonb;
begin
  if nullif(btrim(coalesce(p_current_truth,'')),'') is null or length(btrim(p_current_truth)) > 600 then
    raise exception 'Current truth is required and must be 600 characters or fewer.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_after_truth,'')),'') is null or length(btrim(p_after_truth)) > 600 then
    raise exception 'Truth after completion is required and must be 600 characters or fewer.' using errcode='22023';
  end if;
  if btrim(p_current_truth) = btrim(p_after_truth) then
    raise exception 'The current truth and truth after completion must describe a real change.' using errcode='22023';
  end if;

  v_result := atlas.create_object_work_v2(
    p_farm_id,
    p_object_key,
    p_action_kind,
    p_title,
    null,
    p_after_truth,
    p_unlock_text,
    p_effort_class,
    p_assigned_membership_id,
    p_due_date,
    p_work_window_key,
    p_date_commitment,
    p_bring_into_work_now,
    p_crop_cycle_ids,
    array[]::text[],
    p_idempotency_key
  );

  v_item_id := (v_result -> 'workItem' ->> 'id')::uuid;
  select item.task_id, item.planned_occurrence_id
  into v_task_id, v_occurrence_id
  from atlas.object_work_items item
  where item.id = v_item_id;

  v_transition := jsonb_build_object(
    'contractVersion','object_work_state_change_v1',
    'currentTruth',btrim(p_current_truth),
    'afterTruth',btrim(p_after_truth),
    'objectWorkItemId',v_item_id
  );

  update atlas.object_work_items
  set current_truth = btrim(p_current_truth),
      after_truth = btrim(p_after_truth),
      instructions = null,
      done_definition = btrim(p_after_truth),
      metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('stateTransition',v_transition),
      updated_at = now()
  where id = v_item_id;

  if v_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set task_payload = jsonb_set(
          task_payload,
          '{metadata}',
          coalesce(task_payload -> 'metadata','{}'::jsonb) || jsonb_build_object(
            'state_transition',v_transition,
            'done_definition',btrim(p_after_truth),
            'hide_details',true
          ),
          true
        ),
        metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object('stateTransition',v_transition),
        updated_at = now()
    where id = v_occurrence_id;
  end if;

  if v_task_id is not null then
    update atlas.tasks
    set metadata = coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
          'state_transition',v_transition,
          'done_definition',btrim(p_after_truth),
          'hide_details',true
        ),
        note = null,
        updated_at = now()
    where id = v_task_id;
  end if;

  perform atlas.record_object_work_truth_v1(v_item_id,'current',v_task_id);

  return jsonb_build_object(
    'workItem',atlas.object_work_item_json_v1(v_item_id),
    'taskId',v_task_id,
    'plannedOccurrenceId',v_occurrence_id,
    'deduplicated',coalesce((v_result ->> 'deduplicated')::boolean,false),
    'dayLoad',v_result -> 'dayLoad'
  );
end;
$function$;

create or replace function atlas.sync_object_work_release_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_item atlas.object_work_items%rowtype;
  v_task atlas.tasks%rowtype;
  v_action jsonb;
  v_transition jsonb;
begin
  if new.source_kind <> 'object_work_item'
    or new.released_task_id is null
    or new.released_task_id is not distinct from old.released_task_id then
    return new;
  end if;

  select * into v_item
  from atlas.object_work_items
  where id = new.source_id
  for update;
  if v_item.id is null then return new; end if;

  select * into v_task from atlas.tasks where id = new.released_task_id;
  v_action := atlas.object_work_action_contract_v1(v_item.action_kind);
  v_transition := case
    when v_item.current_truth is not null and v_item.after_truth is not null then jsonb_build_object(
      'contractVersion','object_work_state_change_v1',
      'currentTruth',v_item.current_truth,
      'afterTruth',v_item.after_truth,
      'objectWorkItemId',v_item.id
    )
    else null
  end;

  update atlas.tasks
  set metadata = coalesce(metadata,'{}'::jsonb)
      || jsonb_build_object(
        'object_work_item_id',v_item.id,
        'manual_object_work',true,
        'done_definition',v_item.done_definition,
        'release_mode',v_item.release_mode
      )
      || case when v_transition is not null
        then jsonb_build_object('state_transition',v_transition,'hide_details',true)
        else '{}'::jsonb
      end,
      note = case when v_transition is not null then null else note end,
      updated_at = now()
  where id = v_task.id;

  update atlas.object_work_items
  set status='released', task_id=v_task.id, due_date=v_task.due_date, updated_at=now()
  where id=v_item.id;

  update atlas.object_state
  set operational_truth_task_id = v_task.id,
      updated_at = now()
  where operational_truth_work_item_id = v_item.id
    and operational_truth_source = 'object_work_current'
    and operational_truth_task_id is null;

  insert into atlas.task_notification_plans(
    farm_id, task_id, release_local_time, close_local_time, nudge_after_minutes,
    group_key, group_label, source, active, metadata
  ) values (
    v_item.farm_id, v_task.id, v_item.release_local_time, v_item.close_local_time, 60,
    'object-work:' || (v_item.metadata ->> 'objectKey') || ':' || v_item.action_kind,
    v_action ->> 'label', 'object_work_authoring', true,
    jsonb_build_object('object_work_item_id',v_item.id,'object_id',v_item.object_id,'work_window_key',v_item.work_window_key)
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

  return new;
end;
$function$;

create or replace function atlas.sync_object_work_from_task_status_v1()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_item atlas.object_work_items%rowtype;
  v_can_restore boolean;
begin
  if new.status is not distinct from old.status then return new; end if;

  if new.status='done' then
    for v_item in
      select * from atlas.object_work_items
      where task_id=new.id and status='released'
      for update
    loop
      update atlas.object_work_items
      set status='completed',
          completed_at=coalesce(new.completed_at,now()),
          completion_payload=coalesce(completion_payload,'{}'::jsonb) || jsonb_build_object('taskStatus',new.status,'taskId',new.id),
          updated_at=now()
      where id=v_item.id;

      if v_item.after_truth is not null then
        perform atlas.record_object_work_truth_v1(v_item.id,'after',new.id);
      end if;
    end loop;

    update atlas.planned_work_occurrences
    set state='completed', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';

  elsif new.status in ('skipped','archived') then
    update atlas.object_work_items
    set status='cancelled',
        completion_payload=coalesce(completion_payload,'{}'::jsonb) || jsonb_build_object('taskStatus',new.status,'taskId',new.id),
        updated_at=now()
    where task_id=new.id and status in ('released','completed');

    update atlas.planned_work_occurrences
    set state='cancelled', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';

  elsif new.status in ('open','blocked') and old.status in ('done','skipped','archived') then
    for v_item in
      select * from atlas.object_work_items
      where task_id=new.id
      for update
    loop
      select exists(
        select 1 from atlas.object_state state
        where state.object_id=v_item.object_id
          and state.operational_truth_work_item_id=v_item.id
          and state.operational_truth_source='object_work_completion'
      ) into v_can_restore;

      update atlas.object_work_items
      set status='released', completed_at=null,
          completion_payload=coalesce(completion_payload,'{}'::jsonb) || jsonb_build_object('reopenedAt',now(),'taskId',new.id),
          updated_at=now()
      where id=v_item.id;

      if v_can_restore and v_item.current_truth is not null then
        perform atlas.record_object_work_truth_v1(v_item.id,'current',new.id);
      end if;
    end loop;

    update atlas.planned_work_occurrences
    set state='released', updated_at=now()
    where released_task_id=new.id and source_kind='object_work_item';
  end if;

  return new;
end;
$function$;

revoke all on function atlas.record_object_work_truth_v1(uuid,text,uuid) from public, anon, authenticated;
grant execute on function atlas.record_object_work_truth_v1(uuid,text,uuid) to service_role;

revoke all on function atlas.create_object_work_v3(uuid,text,text,text,text,text,text,text,uuid,date,text,text,boolean,uuid[],text) from public, anon;
grant execute on function atlas.create_object_work_v3(uuid,text,text,text,text,text,text,text,uuid,date,text,text,boolean,uuid[],text) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.create_object_work_v3(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'source','object_work_state_change_v1',
    'call_site','object work composer',
    'authorization','owner or manager',
    'reviewed_date','2026-08-03'
  ),
  now(),
  now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;

comment on column atlas.object_work_items.current_truth is
  'The object truth declared by the task creator before work begins.';
comment on column atlas.object_work_items.after_truth is
  'The object truth Atlas applies when the released task is completed.';
comment on column atlas.object_state.operational_truth is
  'The latest explicit operational truth applied through a prepared state-change contract.';
comment on function atlas.create_object_work_v3(uuid,text,text,text,text,text,text,text,uuid,date,text,text,boolean,uuid[],text) is
  'Creates object-first work as a creator-authored current-truth to after-truth transition. The assigned worker only chooses the task outcome.';

commit;
