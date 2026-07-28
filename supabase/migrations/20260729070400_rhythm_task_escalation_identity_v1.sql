-- A due rhythm and its later failure are one real piece of work, not two task identities.
-- Preserve the current occurrence/task and escalate it to the explicit failure template.

do $$
begin
  if to_regprocedure('atlas.ensure_rhythm_task_v1_base(uuid,text,timestamp with time zone)') is null then
    alter function atlas.ensure_rhythm_task_v1(uuid, text, timestamptz)
      rename to ensure_rhythm_task_v1_base;
  end if;
end;
$$;

create or replace function atlas.ensure_rhythm_task_v1(
  p_state_id uuid,
  p_target_state text,
  p_boundary_at timestamptz
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_template jsonb;
  v_task atlas.tasks%rowtype;
  v_occurrence atlas.planned_work_occurrences%rowtype;
  v_due_date date;
  v_release jsonb;
  v_released_task_id uuid;
  v_action text;
begin
  select * into v_state
  from atlas.rhythm_state
  where id = p_state_id
  for update;

  if v_state.id is null then
    raise exception 'Rhythm state not found.' using errcode = 'P0002';
  end if;

  select * into v_rule
  from atlas.rhythm_rules
  where id = v_state.rhythm_rule_id;

  v_template := case
    when p_target_state = 'due' then v_rule.failure_consequence -> 'dueTask'
    when p_target_state = 'fallen_out_of_rhythm' then
      coalesce(v_rule.failure_consequence -> 'failureTask', v_rule.failure_consequence -> 'dueTask')
    else null
  end;

  if v_template is null or jsonb_typeof(v_template) <> 'object'
     or nullif(btrim(v_template ->> 'title'), '') is null then
    return jsonb_build_object(
      'taskId', null,
      'occurrenceId', null,
      'action', 'no_explicit_task_template'
    );
  end if;

  v_due_date := (p_boundary_at at time zone 'America/Chicago')::date;

  if v_state.current_task_id is not null then
    select * into v_task
    from atlas.tasks
    where id = v_state.current_task_id
      and status in ('open', 'blocked')
    for update;
  end if;

  if v_task.id is not null then
    if p_target_state = 'fallen_out_of_rhythm' then
      update atlas.tasks
      set title = v_template ->> 'title',
          task_type = coalesce(nullif(v_template ->> 'taskType', ''), task_type),
          priority = coalesce(nullif(v_template ->> 'priority', ''), 'high'),
          due_date = least(coalesce(due_date, v_due_date), v_due_date),
          unlock_text = coalesce(nullif(v_template ->> 'unlockText', ''), unlock_text),
          note = coalesce(nullif(v_template ->> 'note', ''), note),
          action_key = coalesce(nullif(v_template ->> 'actionKey', ''), action_key),
          work_class = coalesce(nullif(v_template ->> 'workClass', ''), work_class),
          metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
            'rhythm_target_state', p_target_state,
            'rhythm_failure_escalated_at', p_boundary_at,
            'rhythm_task_identity_preserved', true,
            'clock_version', 'rhythm_clock_v1'
          ),
          updated_at = now()
      where id = v_task.id;

      if v_state.current_occurrence_id is not null then
        update atlas.planned_work_occurrences
        set title = v_template ->> 'title',
            planned_due_date = least(coalesce(planned_due_date, v_due_date), v_due_date),
            task_payload = coalesce(task_payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
              'task_type', nullif(v_template ->> 'taskType', ''),
              'priority', coalesce(nullif(v_template ->> 'priority', ''), 'high'),
              'unlock_text', nullif(v_template ->> 'unlockText', ''),
              'note', nullif(v_template ->> 'note', ''),
              'action_key', nullif(v_template ->> 'actionKey', ''),
              'work_class', nullif(v_template ->> 'workClass', ''),
              'metadata', coalesce(task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
                'rhythm_target_state', p_target_state,
                'rhythm_failure_escalated_at', p_boundary_at,
                'rhythm_task_identity_preserved', true
              )
            )),
            metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
              'rhythm_target_state', p_target_state,
              'rhythm_failure_escalated_at', p_boundary_at,
              'rhythm_task_identity_preserved', true
            ),
            updated_at = now()
        where id = v_state.current_occurrence_id;
      end if;

      v_action := 'escalated_current_task';
    else
      v_action := 'kept_current';
    end if;

    return jsonb_build_object(
      'taskId', v_task.id,
      'occurrenceId', v_state.current_occurrence_id,
      'action', v_action
    );
  end if;

  if v_state.current_occurrence_id is not null then
    select * into v_occurrence
    from atlas.planned_work_occurrences
    where id = v_state.current_occurrence_id
      and state in ('planned', 'eligible', 'failed', 'releasing')
      and released_task_id is null
    for update;
  end if;

  if v_occurrence.id is not null then
    update atlas.planned_work_occurrences
    set title = v_template ->> 'title',
        planned_due_date = least(coalesce(planned_due_date, v_due_date), v_due_date),
        task_payload = coalesce(task_payload, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object(
          'task_type', nullif(v_template ->> 'taskType', ''),
          'priority', coalesce(
            nullif(v_template ->> 'priority', ''),
            case when p_target_state = 'fallen_out_of_rhythm' then 'high' else 'normal' end
          ),
          'unlock_text', nullif(v_template ->> 'unlockText', ''),
          'note', nullif(v_template ->> 'note', ''),
          'action_key', nullif(v_template ->> 'actionKey', ''),
          'work_class', nullif(v_template ->> 'workClass', ''),
          'metadata', coalesce(task_payload -> 'metadata', '{}'::jsonb) || jsonb_build_object(
            'rhythm_target_state', p_target_state,
            'rhythm_boundary_at', p_boundary_at,
            'rhythm_task_identity_preserved', true,
            'clock_version', 'rhythm_clock_v1'
          )
        )),
        metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
          'rhythm_target_state', p_target_state,
          'rhythm_boundary_at', p_boundary_at,
          'rhythm_task_identity_preserved', true
        ),
        state = case when state = 'failed' then 'eligible' else state end,
        updated_at = now()
    where id = v_occurrence.id;

    v_release := atlas.signal_work_occurrence_v1(
      v_occurrence.id,
      'rhythm_clock:' || p_target_state,
      jsonb_build_object(
        'rhythm_state_id', v_state.id,
        'boundary_at', p_boundary_at,
        'task_identity_preserved', true
      )
    );

    select released_task_id into v_released_task_id
    from atlas.planned_work_occurrences
    where id = v_occurrence.id;

    update atlas.rhythm_state
    set current_task_id = v_released_task_id,
        current_occurrence_id = v_occurrence.id,
        updated_at = now()
    where id = v_state.id;

    return jsonb_build_object(
      'taskId', v_released_task_id,
      'occurrenceId', v_occurrence.id,
      'action', case
        when v_released_task_id is null then 'updated_current_occurrence_awaiting_capacity'
        when p_target_state = 'fallen_out_of_rhythm' then 'released_escalated_current_occurrence'
        else 'released_current_occurrence'
      end
    );
  end if;

  return atlas.ensure_rhythm_task_v1_base(
    p_state_id,
    p_target_state,
    p_boundary_at
  );
end;
$$;

revoke all on function atlas.ensure_rhythm_task_v1_base(uuid, text, timestamptz)
  from public, anon, authenticated;
revoke all on function atlas.ensure_rhythm_task_v1(uuid, text, timestamptz)
  from public, anon, authenticated;