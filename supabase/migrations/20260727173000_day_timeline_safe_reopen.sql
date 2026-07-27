-- Day timeline quick-complete needs a real inverse transition. Reopening is
-- deliberately conservative: Atlas may retract an untouched completion, but it
-- refuses to erase biological milestones or downstream work that has already
-- been acted on.

alter table atlas.task_transitions
  drop constraint if exists task_transitions_transition_check;

alter table atlas.task_transitions
  add constraint task_transitions_transition_check
  check (transition = any (array[
    'done'::text,
    'partial'::text,
    'blocked'::text,
    'not_relevant'::text,
    'changed_plan'::text,
    'rescheduled'::text,
    'unfinished'::text,
    'reopened'::text,
    'checklist_done'::text,
    'checklist_open'::text,
    'note'::text
  ]));

create or replace function atlas.reopen_task_completion_v1_internal(
  p_task_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_done atlas.task_transitions%rowtype;
  v_existing atlas.task_transitions%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_target_occurrence atlas.planned_work_occurrences%rowtype;
  v_target_task atlas.tasks%rowtype;
  v_queue_item atlas.task_release_queue_items%rowtype;
  v_next_queue atlas.task_release_queue_items%rowtype;
  v_now timestamptz := now();
  v_key text := nullif(btrim(p_idempotency_key), '');
  v_outcome_id uuid;
  v_transition_id uuid;
  v_next_task_id uuid;
  v_snapshot jsonb;
  v_handoff atlas.workflow_handoffs%rowtype;
  v_cancelled_downstream integer := 0;
  v_restored_objects integer := 0;
  v_action text;
begin
  if p_task_id is null then
    raise exception 'Task id is required.' using errcode = '22023';
  end if;

  if v_key is null or length(v_key) > 160 then
    raise exception 'A valid idempotency key is required.' using errcode = '22023';
  end if;

  if p_payload is null then
    p_payload := '{}'::jsonb;
  elsif jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Task reopen payload must be a JSON object.' using errcode = '22023';
  end if;

  select * into v_task
  from atlas.tasks
  where id = p_task_id
  for update;

  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(v_task.farm_id::text || ':' || v_key, 0));

  select * into v_existing
  from atlas.task_transitions
  where farm_id = v_task.farm_id
    and idempotency_key = v_key;

  if v_existing.id is not null then
    return jsonb_build_object(
      'transitionId', v_existing.id,
      'taskId', v_existing.task_id,
      'status', v_existing.next_status,
      'fieldLogId', v_existing.field_log_id,
      'taskOutcomeEventId', v_existing.task_outcome_event_id,
      'childTaskIds', '[]'::jsonb,
      'childrenClosed', 0,
      'nextTaskId', null,
      'deduplicated', true,
      'warnings', '[]'::jsonb
    );
  end if;

  if v_task.status <> 'done' then
    raise exception 'Only a completed task can be reopened.' using errcode = '22023';
  end if;

  select * into v_done
  from atlas.task_transitions
  where task_id = v_task.id
    and transition in ('done', 'checklist_done')
    and next_status = 'done'
  order by created_at desc, id desc
  limit 1
  for update;

  if v_done.id is null then
    raise exception 'The completion record could not be found.' using errcode = 'P0003';
  end if;

  -- These milestones represent observed or completed biological facts. They need
  -- a correction workflow rather than a status toggle.
  if v_task.generated_from = 'crop_cycle_milestone'
     or lower(coalesce(v_task.task_type, '')) like '%germination%'
     or lower(coalesce(v_task.task_type, '')) like '%harvest%'
     or lower(coalesce(v_task.task_type, '')) like '%transplant%'
     or lower(coalesce(v_task.action_key, '')) in (
       'germination_check', 'harvest', 'harvest_watch', 'clear_bed',
       'plant', 'transplant', 'sow', 'seed'
     )
     or lower(coalesce(v_task.metadata ->> 'planting_log_required', 'false')) in ('true', 'yes', '1')
  then
    raise exception 'This completion contains crop or production evidence. Open the card and correct the recorded result instead.' using errcode = 'P0003';
  end if;

  if jsonb_array_length(coalesce(v_done.payload -> 'child_task_ids', '[]'::jsonb)) > 0 then
    raise exception 'This completion also closed checklist work. Open the card and review the linked steps before correcting it.' using errcode = 'P0003';
  end if;

  if v_done.field_log_id is not null and exists (
    select 1 from atlas.planting_claims pc where pc.field_log_id = v_done.field_log_id
  ) then
    raise exception 'This completion created a planting record. Open the card and correct the field evidence instead.' using errcode = 'P0003';
  end if;

  -- A completion may have satisfied workflow handoffs. Untouched generated work
  -- can be folded back into its occurrence; acted-on work blocks automatic undo.
  for v_handoff in
    select h.*
    from atlas.workflow_handoffs h
    where h.farm_id = v_task.farm_id
      and h.satisfied_at is not null
      and h.satisfied_by_event_id in (
        select we.id
        from atlas.workflow_events we
        where we.farm_id = v_task.farm_id
          and we.source_kind = 'task'
          and we.source_id = v_task.id
          and we.source_event = 'done'
          and (
            v_done.task_outcome_event_id is null
            or we.payload ->> 'task_outcome_event_id' = v_done.task_outcome_event_id::text
          )
      )
    for update
  loop
    if v_handoff.target_occurrence_id is null then
      raise exception 'This completion opened linked work that needs review before it can be corrected.' using errcode = 'P0003';
    end if;

    select * into v_target_occurrence
    from atlas.planned_work_occurrences
    where id = v_handoff.target_occurrence_id
    for update;

    if v_target_occurrence.id is null then
      raise exception 'A downstream occurrence is missing and needs Owner review.' using errcode = 'P0003';
    end if;

    if v_target_occurrence.state = 'completed' then
      raise exception 'Downstream work has already been completed. Correct this completion from the task card.' using errcode = 'P0003';
    end if;

    if v_target_occurrence.released_task_id is not null then
      select * into v_target_task
      from atlas.tasks
      where id = v_target_occurrence.released_task_id
      for update;

      if v_target_task.id is null
         or v_target_task.status not in ('open', 'blocked')
         or exists (select 1 from atlas.task_transitions tt where tt.task_id = v_target_task.id)
         or exists (select 1 from atlas.task_outcome_events toe where toe.task_id = v_target_task.id)
      then
        raise exception 'Downstream work has already been acted on. Correct this completion from the task card.' using errcode = 'P0003';
      end if;

      update atlas.tasks
      set status = 'archived',
          due_date = null,
          completed_at = null,
          completed_by = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'archived_reason', 'Source completion reopened',
            'retracted_source_task_id', v_task.id,
            'retracted_at', v_now
          ),
          updated_at = v_now
      where id = v_target_task.id;

      v_cancelled_downstream := v_cancelled_downstream + 1;
    end if;

    update atlas.planned_work_occurrences
    set state = 'planned',
        gate_satisfied_at = null,
        released_at = null,
        released_task_id = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'source_completion_reopened', true,
          'source_task_id', v_task.id,
          'retracted_at', v_now
        ),
        updated_at = v_now
    where id = v_target_occurrence.id;

    update atlas.workflow_handoffs
    set target_task_id = null,
        satisfied_at = null,
        satisfied_by_event_id = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'satisfaction_retracted_at', v_now,
          'satisfaction_retracted_by_task_id', v_task.id
        ),
        updated_at = v_now
    where id = v_handoff.id;
  end loop;

  -- Recurring completion may have created the next concrete task directly.
  begin
    v_next_task_id := nullif(v_done.payload ->> 'next_task_id', '')::uuid;
  exception when others then
    v_next_task_id := null;
  end;

  if v_next_task_id is not null then
    select * into v_target_task
    from atlas.tasks
    where id = v_next_task_id
    for update;

    if v_target_task.id is not null then
      if v_target_task.status not in ('open', 'blocked')
         or exists (select 1 from atlas.task_transitions tt where tt.task_id = v_target_task.id)
         or exists (select 1 from atlas.task_outcome_events toe where toe.task_id = v_target_task.id)
      then
        raise exception 'The next recurring task has already been acted on. Correct this completion from the task card.' using errcode = 'P0003';
      end if;

      update atlas.tasks
      set status = 'archived',
          due_date = null,
          completed_at = null,
          completed_by = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'archived_reason', 'Previous recurrence completion reopened',
            'retracted_source_task_id', v_task.id,
            'retracted_at', v_now
          ),
          updated_at = v_now
      where id = v_target_task.id;

      update atlas.planned_work_occurrences
      set state = 'cancelled',
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'cancelled_by_reopened_recurrence', true,
            'source_task_id', v_task.id,
            'cancelled_at', v_now
          ),
          updated_at = v_now
      where released_task_id = v_target_task.id;

      v_cancelled_downstream := v_cancelled_downstream + 1;
    end if;
  end if;

  -- Completion-gated queues are also reversible while the next item is untouched.
  select * into v_queue_item
  from atlas.task_release_queue_items
  where task_id = v_task.id
  for update;

  if v_queue_item.id is not null and v_queue_item.state = 'completed' then
    select * into v_next_queue
    from atlas.task_release_queue_items
    where farm_id = v_queue_item.farm_id
      and queue_key = v_queue_item.queue_key
      and position > v_queue_item.position
      and state in ('active', 'completed')
    order by position
    limit 1
    for update;

    if v_next_queue.id is not null and v_next_queue.state = 'completed' then
      raise exception 'Later queued work has already been completed. Correct this completion from the task card.' using errcode = 'P0003';
    end if;

    if v_next_queue.id is not null and v_next_queue.task_id is not null then
      select * into v_target_task
      from atlas.tasks
      where id = v_next_queue.task_id
      for update;

      if v_target_task.id is null
         or v_target_task.status not in ('open', 'blocked')
         or exists (select 1 from atlas.task_transitions tt where tt.task_id = v_target_task.id)
         or exists (select 1 from atlas.task_outcome_events toe where toe.task_id = v_target_task.id)
      then
        raise exception 'The next queued task has already been acted on. Correct this completion from the task card.' using errcode = 'P0003';
      end if;

      update atlas.tasks
      set status = 'archived',
          due_date = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'archived_reason', 'Previous queue item reopened',
            'retracted_source_task_id', v_task.id,
            'retracted_at', v_now
          ),
          updated_at = v_now
      where id = v_target_task.id;

      update atlas.planned_work_occurrences
      set state = 'planned',
          gate_satisfied_at = null,
          released_at = null,
          released_task_id = null,
          updated_at = v_now
      where id = v_next_queue.planned_occurrence_id;

      update atlas.task_release_queue_items
      set state = 'queued',
          task_id = null,
          activated_at = null,
          completed_at = null,
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'activation_retracted_at', v_now,
            'activation_retracted_by_task_id', v_task.id
          ),
          updated_at = v_now
      where id = v_next_queue.id;

      v_cancelled_downstream := v_cancelled_downstream + 1;
    end if;

    update atlas.task_release_queue_items
    set state = 'active',
        completed_at = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'completion_reopened_at', v_now
        ),
        updated_at = v_now
    where id = v_queue_item.id;
  end if;

  -- Keep the audit evidence, but explicitly retract the completion log and object
  -- events so later readers do not treat the accidental tap as farm truth.
  if v_done.field_log_id is not null then
    update atlas.field_logs
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'retracted', true,
          'retracted_at', v_now,
          'retracted_reason', 'Task completion reopened',
          'retracted_task_id', v_task.id
        ),
        updated_at = v_now
    where id = v_done.field_log_id;

    update atlas.object_activity_events
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'retracted', true,
          'retracted_at', v_now,
          'retracted_reason', 'Task completion reopened',
          'retracted_task_id', v_task.id
        ),
        updated_at = v_now
    where field_log_id = v_done.field_log_id;
  end if;

  -- Quick-complete sends the prior object state so the inverse transition can
  -- restore it exactly. Older simple completions fall back to unknown for the
  -- single condition that Done changed.
  for v_snapshot in
    select value
    from jsonb_array_elements(coalesce(v_done.payload -> 'objectStateBefore', '[]'::jsonb))
  loop
    update atlas.object_state
    set life_status = coalesce(nullif(v_snapshot ->> 'life_status', ''), 'open'),
        weed_pressure = coalesce(nullif(v_snapshot ->> 'weed_pressure', ''), 'unknown'),
        water_status = coalesce(nullif(v_snapshot ->> 'water_status', ''), 'unknown'),
        last_touched_at = case when nullif(v_snapshot ->> 'last_touched_at', '') is null then null else (v_snapshot ->> 'last_touched_at')::date end,
        last_weeded_at = case when nullif(v_snapshot ->> 'last_weeded_at', '') is null then null else (v_snapshot ->> 'last_weeded_at')::date end,
        last_watered_at = case when nullif(v_snapshot ->> 'last_watered_at', '') is null then null else (v_snapshot ->> 'last_watered_at')::date end,
        last_checked_at = case when nullif(v_snapshot ->> 'last_checked_at', '') is null then null else (v_snapshot ->> 'last_checked_at')::date end,
        decision_required = coalesce((v_snapshot ->> 'decision_required')::boolean, false),
        presentability = coalesce(nullif(v_snapshot ->> 'presentability', ''), 'unknown'),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'restored_by_reopened_task_id', v_task.id,
          'restored_at', v_now
        ),
        updated_at = v_now
    where object_id = (v_snapshot ->> 'object_id')::uuid
      and farm_id = v_task.farm_id;

    v_restored_objects := v_restored_objects + 1;
  end loop;

  v_action := lower(coalesce(v_done.action_key, v_task.action_key, v_task.task_type, ''));
  if v_restored_objects = 0 and v_action in ('weed', 'weeding') then
    update atlas.object_state os
    set weed_pressure = 'unknown',
        last_weeded_at = (
          select max(oae.event_date)
          from atlas.object_activity_events oae
          where oae.object_id = os.object_id
            and oae.event_type = 'weeded'
            and coalesce((oae.metadata ->> 'retracted')::boolean, false) = false
        ),
        updated_at = v_now
    where os.object_id in (select object_id from atlas.task_objects where task_id = v_task.id);
  elsif v_restored_objects = 0 and v_action in ('water', 'watering') then
    update atlas.object_state os
    set water_status = 'unknown',
        last_watered_at = (
          select max(oae.event_date)
          from atlas.object_activity_events oae
          where oae.object_id = os.object_id
            and oae.event_type = 'watered'
            and coalesce((oae.metadata ->> 'retracted')::boolean, false) = false
        ),
        updated_at = v_now
    where os.object_id in (select object_id from atlas.task_objects where task_id = v_task.id);
  end if;

  update atlas.tasks
  set status = 'open',
      completed_at = null,
      completed_by = null,
      blocker_text = null,
      metadata = coalesce(metadata, '{}'::jsonb)
        || jsonb_build_object(
          'checklist_status', 'open',
          'checklist_completed_at', null,
          'completion_source', null,
          'completion_reopened_at', v_now,
          'completion_reopened_from_transition_id', v_done.id,
          'last_transition', jsonb_build_object(
            'transition', 'reopened',
            'recorded_at', v_now,
            'idempotency_key', v_key
          )
        ),
      updated_at = v_now
  where id = v_task.id;

  if v_task.planned_occurrence_id is not null then
    select * into v_occurrence
    from atlas.planned_work_occurrences
    where id = v_task.planned_occurrence_id
    for update;

    update atlas.planned_work_occurrences
    set state = 'released',
        released_task_id = v_task.id,
        released_at = coalesce(released_at, v_now),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'terminal_task_status', 'open',
          'reopened_at', v_now,
          'reopened_task_id', v_task.id
        ),
        updated_at = v_now
    where id = v_task.planned_occurrence_id;
  end if;

  update atlas.project_steps
  set status = 'open',
      completed_at = null,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'reopened_with_task_id', v_task.id,
        'reopened_at', v_now
      ),
      updated_at = v_now
  where linked_task_id = v_task.id
    and status = 'done';

  insert into atlas.task_outcome_events (
    farm_id, task_id, outcome, lane_key, work_key, note,
    task_title, task_type, zone_id, due_date, priority, source, metadata
  ) values (
    v_task.farm_id,
    v_task.id,
    'reopened',
    v_done.action_key,
    coalesce(v_done.work_class, v_task.action_key),
    'Completion reopened from the Day timeline.',
    v_task.title,
    v_task.task_type,
    v_task.zone_id,
    v_task.due_date,
    v_task.priority,
    'atlas_task_engine',
    jsonb_build_object(
      'version', 'task_reopen_v1',
      'reopened_completion_transition_id', v_done.id,
      'retracted_field_log_id', v_done.field_log_id,
      'cancelled_downstream_count', v_cancelled_downstream,
      'restored_object_count', v_restored_objects
    )
  ) returning id into v_outcome_id;

  insert into atlas.task_transitions (
    farm_id, task_id, transition, previous_status, next_status,
    previous_due_date, target_date, action_key, work_class,
    note, reason, field_log_id, task_outcome_event_id,
    idempotency_key, payload, actor_user_id, actor_membership_id, actor_role
  ) values (
    v_task.farm_id,
    v_task.id,
    'reopened',
    'done',
    'open',
    v_task.due_date,
    v_task.due_date,
    coalesce(v_done.action_key, v_task.action_key),
    coalesce(v_done.work_class, v_task.work_class),
    'Completion reopened from the Day timeline.',
    'Completed timeline dot was tapped again.',
    null,
    v_outcome_id,
    v_key,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'reopened_completion_transition_id', v_done.id,
      'retracted_field_log_id', v_done.field_log_id,
      'cancelled_downstream_count', v_cancelled_downstream,
      'restored_object_count', v_restored_objects
    ),
    auth.uid(),
    atlas.current_membership_id(v_task.farm_id),
    atlas.current_farm_role(v_task.farm_id)
  ) returning id into v_transition_id;

  return jsonb_build_object(
    'transitionId', v_transition_id,
    'taskId', v_task.id,
    'status', 'open',
    'fieldLogId', null,
    'taskOutcomeEventId', v_outcome_id,
    'childTaskIds', '[]'::jsonb,
    'childrenClosed', 0,
    'nextTaskId', null,
    'deduplicated', false,
    'warnings', '[]'::jsonb,
    'cancelledDownstream', v_cancelled_downstream,
    'restoredObjects', v_restored_objects
  );
end;
$function$;

create or replace function atlas.owner_reopen_task_completion_v1(
  p_task_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_farm_id uuid;
begin
  select farm_id into v_farm_id from atlas.tasks where id = p_task_id;
  if v_farm_id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;
  if not atlas.is_farm_owner(v_farm_id) then
    raise exception 'Owner membership required for task correction.' using errcode = '42501';
  end if;
  return atlas.reopen_task_completion_v1_internal(p_task_id, p_idempotency_key, p_payload);
end;
$function$;

create or replace function atlas.worker_reopen_task_completion_v1(
  p_task_id uuid,
  p_idempotency_key text,
  p_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_task atlas.tasks%rowtype;
  v_membership_id uuid;
  v_role text;
begin
  select * into v_task from atlas.tasks where id = p_task_id;
  if v_task.id is null then
    raise exception 'Task was not found.' using errcode = 'P0002';
  end if;

  v_role := atlas.current_farm_role(v_task.farm_id);
  v_membership_id := atlas.current_membership_id(v_task.farm_id);

  if v_role not in ('farm_hand', 'manager')
     or v_membership_id is null
     or v_task.visibility_scope <> 'assigned_worker'
     or v_task.assigned_membership_id <> v_membership_id
  then
    raise exception 'This task is not assigned to the signed-in farm member.' using errcode = '42501';
  end if;

  return atlas.reopen_task_completion_v1_internal(
    p_task_id,
    p_idempotency_key,
    coalesce(p_payload, '{}'::jsonb) || jsonb_build_object(
      'actor_user_id', auth.uid(),
      'actor_membership_id', v_membership_id,
      'actor_role', v_role
    )
  );
end;
$function$;

grant execute on function atlas.owner_reopen_task_completion_v1(uuid, text, jsonb) to authenticated;
grant execute on function atlas.worker_reopen_task_completion_v1(uuid, text, jsonb) to authenticated;
