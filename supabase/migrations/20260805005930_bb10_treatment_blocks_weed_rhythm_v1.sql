create or replace function atlas.activate_deferred_rhythm_bindings_after_task_v1()
returns trigger
language plpgsql
security definer
set search_path to pg_catalog, atlas
as $function$
declare
  v_binding record;
  v_satisfaction_id uuid;
  v_satisfaction_key text;
  v_satisfied_at timestamptz := coalesce(new.completed_at, new.updated_at, now());
begin
  if new.status <> 'done' or old.status = 'done' then
    return new;
  end if;

  for v_binding in
    select
      b.id as binding_id,
      s.id as state_id,
      s.organization_id,
      s.farm_id,
      s.rhythm_rule_id,
      s.rhythm_key,
      s.subject_kind,
      s.subject_id
    from atlas.rhythm_bindings b
    join atlas.rhythm_state s on s.rhythm_binding_id = b.id
    where b.farm_id = new.farm_id
      and not b.active
      and (
        nullif(b.metadata ->> 'activationPrerequisiteTaskId', '') = new.id::text
        or (
          nullif(b.metadata ->> 'activationPrerequisiteTaskKey', '') is not null
          and b.metadata ->> 'activationPrerequisiteTaskKey' = new.metadata ->> 'task_key'
        )
      )
  loop
    v_satisfaction_key := 'activation_prerequisite:' || new.id::text || ':state:' || v_binding.state_id::text;

    insert into atlas.rhythm_satisfactions (
      organization_id,
      farm_id,
      rhythm_state_id,
      rhythm_binding_id,
      rhythm_rule_id,
      rhythm_key,
      subject_kind,
      subject_id,
      satisfaction_key,
      satisfaction_kind,
      satisfied_at,
      source_kind,
      source_id,
      source_event,
      source_task_id,
      source_object_id,
      policy_match,
      evidence
    ) values (
      v_binding.organization_id,
      v_binding.farm_id,
      v_binding.state_id,
      v_binding.binding_id,
      v_binding.rhythm_rule_id,
      v_binding.rhythm_key,
      v_binding.subject_kind,
      v_binding.subject_id,
      v_satisfaction_key,
      'full',
      v_satisfied_at,
      'task',
      new.id,
      'activation_prerequisite_completed',
      new.id,
      case when v_binding.subject_kind = 'growing_object' then v_binding.subject_id else null end,
      jsonb_build_object(
        'activationMode', 'task_prerequisite',
        'taskId', new.id,
        'taskKey', new.metadata ->> 'task_key'
      ),
      jsonb_build_object(
        'taskTitle', new.title,
        'completedAt', v_satisfied_at,
        'taskStatus', new.status
      )
    )
    on conflict (farm_id, satisfaction_key) do nothing
    returning id into v_satisfaction_id;

    if v_satisfaction_id is null then
      select id into v_satisfaction_id
      from atlas.rhythm_satisfactions
      where farm_id = v_binding.farm_id
        and satisfaction_key = v_satisfaction_key;
    end if;

    update atlas.rhythm_bindings
    set active = true,
        active_from = v_satisfied_at,
        active_until = null,
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'activationStatus', 'active',
          'activatedAt', v_satisfied_at,
          'activatedByTaskId', new.id,
          'activatedByTaskKey', new.metadata ->> 'task_key'
        ),
        updated_at = now()
    where id = v_binding.binding_id;

    update atlas.rhythm_state
    set last_qualifying_satisfaction_id = v_satisfaction_id,
        lease_started_at = v_satisfied_at,
        current_task_id = null,
        current_occurrence_id = null,
        recovery_started_at = null,
        metadata = (coalesce(metadata, '{}'::jsonb) - 'pausedUntil') || jsonb_build_object(
          'activationStatus', 'active',
          'activatedAt', v_satisfied_at,
          'activatedByTaskId', new.id,
          'activatedByTaskKey', new.metadata ->> 'task_key'
        ),
        updated_at = now()
    where id = v_binding.state_id;

    perform atlas.evaluate_rhythm_binding_v1(
      v_binding.state_id,
      v_satisfied_at,
      'activation_prerequisite_completed'
    );
  end loop;

  return new;
end;
$function$;

drop trigger if exists activate_deferred_rhythm_bindings_after_task_v1 on atlas.tasks;
create trigger activate_deferred_rhythm_bindings_after_task_v1
after update of status on atlas.tasks
for each row
when (new.status = 'done' and old.status is distinct from new.status)
execute function atlas.activate_deferred_rhythm_bindings_after_task_v1();

do $migration$
declare
  v_object_id uuid;
  v_binding_id uuid;
  v_state_id uuid;
  v_confirm_task_id uuid;
  v_bad_task_id uuid;
  v_bad_occurrence_id uuid;
begin
  select id into v_object_id
  from atlas.growing_objects
  where stable_key = 'bb_10';

  if v_object_id is null then
    raise exception 'BB10 growing object was not found.';
  end if;

  select id into v_confirm_task_id
  from atlas.tasks
  where metadata ->> 'task_key' = 'owner_20260825_confirm_bb10_treatment_complete'
  order by created_at desc
  limit 1;

  if v_confirm_task_id is null then
    raise exception 'BB10 treatment confirmation task was not found.';
  end if;

  select b.id, s.id, s.current_task_id, s.current_occurrence_id
    into v_binding_id, v_state_id, v_bad_task_id, v_bad_occurrence_id
  from atlas.rhythm_bindings b
  join atlas.rhythm_state s on s.rhythm_binding_id = b.id
  where b.subject_kind = 'growing_object'
    and b.subject_id = v_object_id
    and s.rhythm_key = 'weed_stewardship'
  order by b.priority desc, b.created_at desc
  limit 1;

  if v_binding_id is null or v_state_id is null then
    raise exception 'BB10 weed rhythm binding was not found.';
  end if;

  update atlas.rhythm_bindings
  set active = false,
      active_until = now(),
      owner_reason = 'Paused while BB10 completes its three-pass Bermuda-grass treatment.',
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
        'activationStatus', 'waiting_for_prerequisite',
        'activationPrerequisiteTaskId', v_confirm_task_id,
        'activationPrerequisiteTaskKey', 'owner_20260825_confirm_bb10_treatment_complete',
        'activationReason', 'BB10 is unavailable for weeding until all three spray passes and the treatment-complete inspection are done.',
        'pausedAt', now()
      ),
      updated_at = now()
  where id = v_binding_id;

  perform atlas.evaluate_rhythm_binding_v1(
    v_state_id,
    now(),
    'bb10_treatment_gate_correction'
  );

  if v_bad_task_id is not null and exists (
    select 1 from atlas.tasks
    where id = v_bad_task_id
      and status in ('open', 'blocked')
  ) then
    perform atlas.record_task_transition_v1(
      v_bad_task_id,
      'not_relevant',
      'bb10-treatment-gate-correction-20260804',
      null,
      'BB10 is under a three-pass Bermuda-grass treatment and is not currently weedable.',
      'This weed task was released before the treatment prerequisites were complete.',
      'rhythm',
      'weed',
      jsonb_build_object(
        'correction', 'bb10_treatment_blocks_weeding',
        'activationPrerequisiteTaskId', v_confirm_task_id,
        'activationPrerequisiteTaskKey', 'owner_20260825_confirm_bb10_treatment_complete'
      ),
      null
    );
  end if;

  if v_bad_occurrence_id is not null then
    update atlas.planned_work_occurrences
    set state = 'cancelled',
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'cancelledReason', 'BB10 is not weedable while Bermuda-grass treatment is active.',
          'cancelledBy', 'bb10_treatment_blocks_weed_rhythm_v1',
          'cancelledAt', now()
        ),
        updated_at = now()
    where id = v_bad_occurrence_id
      and state in ('planned', 'eligible', 'releasing', 'released', 'failed');
  end if;

  update atlas.rhythm_state
  set state = 'paused',
      lease_started_at = null,
      warning_at = null,
      due_at = null,
      failure_at = null,
      recovery_started_at = null,
      last_qualifying_satisfaction_id = null,
      current_task_id = null,
      current_occurrence_id = null,
      state_reason = jsonb_build_object(
        'transitionKind', 'paused',
        'triggerKind', 'bb10_treatment_gate_correction',
        'reason', 'Three spray passes and treatment confirmation must finish before BB10 enters the weed rhythm.'
      ),
      metadata = (coalesce(metadata, '{}'::jsonb) - 'pausedUntil') || jsonb_build_object(
        'activationStatus', 'waiting_for_prerequisite',
        'activationPrerequisiteTaskId', v_confirm_task_id,
        'activationPrerequisiteTaskKey', 'owner_20260825_confirm_bb10_treatment_complete',
        'pausedBy', 'bb10_treatment_blocks_weed_rhythm_v1',
        'pausedReason', 'BB10 is unavailable for weeding during Bermuda-grass treatment.'
      ),
      updated_at = now()
  where id = v_state_id;
end;
$migration$;