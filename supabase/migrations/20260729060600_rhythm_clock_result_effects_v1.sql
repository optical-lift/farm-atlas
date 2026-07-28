create or replace function atlas.apply_result_rhythm_effects_v1(p_workflow_event_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_event atlas.workflow_events%rowtype;
  v_state record;
  v_rule atlas.rhythm_rules%rowtype;
  v_touch jsonb;
  v_touch_index integer;
  v_effect text;
  v_satisfaction_kind text;
  v_satisfaction_id uuid;
  v_latest_satisfaction_id uuid;
  v_satisfaction_key text;
  v_actor_user_id uuid;
  v_source_task_id uuid;
  v_source_field_log_id uuid;
  v_source_object_id uuid;
  v_source_crop_cycle_id uuid;
  v_source_project_id uuid;
  v_renewal_seconds integer;
  v_evaluation jsonb;
  v_transition_key text;
  v_transition_id uuid;
  v_matched integer := 0;
  v_satisfied integer := 0;
  v_recovering integer := 0;
begin
  select * into v_event from atlas.workflow_events where id = p_workflow_event_id;
  if v_event.id is null then
    raise exception 'Workflow event not found.' using errcode = 'P0002';
  end if;

  v_source_task_id := case
    when v_event.source_kind = 'task' then v_event.source_id
    else atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{metadata,task_id}')
  end;
  v_source_field_log_id := case
    when v_event.source_kind = 'field_log' then v_event.source_id
    else atlas.rhythm_safe_uuid_v1(v_event.payload ->> 'field_log_id')
  end;
  v_actor_user_id := atlas.rhythm_safe_uuid_v1(v_event.payload #>> '{metadata,actor_user_id}');
  v_source_object_id := case when v_event.source_kind = 'object' then v_event.source_id else null end;
  v_source_crop_cycle_id := case when v_event.source_kind = 'crop_cycle' then v_event.source_id else null end;
  v_source_project_id := case when v_event.source_kind = 'project' then v_event.source_id else null end;

  for v_state in
    select distinct s.*
    from atlas.rhythm_state s
    join atlas.rhythm_workflow_subjects_v1(v_event.id) affected
      on affected.subject_kind = s.subject_kind
     and affected.subject_id = s.subject_id
    where s.farm_id = v_event.farm_id
  loop
    -- New canonical results evaluate the current clock boundary first, then apply
    -- their result effect. Replayed older events never move the Clock backwards.
    if v_state.last_evaluated_at is null or v_event.created_at >= v_state.last_evaluated_at then
      v_evaluation := atlas.evaluate_rhythm_binding_v1(v_state.id, v_event.created_at, 'workflow_precheck');
      select * into v_state from atlas.rhythm_state where id = v_state.id;
    end if;

    select r.* into v_rule
    from atlas.rhythm_bindings b
    join atlas.rhythm_rules r on r.id = b.rhythm_rule_id
    where b.id = v_state.rhythm_binding_id
      and b.active
      and r.status = 'active';

    if v_rule.id is null then
      continue;
    end if;

    v_touch_index := 0;
    for v_touch in select value from jsonb_array_elements(v_rule.qualifying_touches)
    loop
      v_touch_index := v_touch_index + 1;
      if not atlas.rhythm_touch_matches_workflow_v1(v_touch, v_event.id) then
        continue;
      end if;

      v_matched := v_matched + 1;
      v_effect := coalesce(nullif(lower(v_touch ->> 'effect'), ''), 'full');

      if v_effect = 'partial' then
        if coalesce(v_state.last_transition_at, '-infinity'::timestamptz) > v_event.created_at
           or exists (
             select 1
             from atlas.rhythm_satisfactions later
             where later.rhythm_state_id = v_state.id
               and later.satisfied_at > v_event.created_at
           ) then
          exit;
        end if;

        v_transition_key := 'workflow:' || v_event.id::text || ':state:' || v_state.id::text || ':recovering';
        v_transition_id := atlas.record_rhythm_transition_v1(
          p_state_id => v_state.id,
          p_transition_key => v_transition_key,
          p_transition_kind => 'recovering',
          p_from_state => v_state.state,
          p_to_state => 'recovering',
          p_boundary_kind => 'partial_result',
          p_boundary_at => v_event.created_at,
          p_evaluated_at => now(),
          p_task_id => v_source_task_id,
          p_payload => jsonb_build_object(
            'workflowEventId', v_event.id,
            'policyTouch', v_touch,
            'sourceKind', v_event.source_kind,
            'sourceEvent', v_event.source_event
          )
        );

        update atlas.rhythm_state
        set state = 'recovering',
            recovery_started_at = v_event.created_at,
            current_task_id = coalesce(v_source_task_id, current_task_id),
            last_evaluated_at = now(),
            last_transition_at = v_event.created_at,
            state_reason = jsonb_build_object(
              'transitionId', v_transition_id,
              'transitionKind', 'recovering',
              'workflowEventId', v_event.id
            ),
            updated_at = now()
        where id = v_state.id;

        v_recovering := v_recovering + 1;
        exit;
      elsif v_effect in ('full','conditional','modifier','game_master') then
        v_satisfaction_kind := v_effect;
        v_renewal_seconds := case when coalesce(v_touch ->> 'renewalIntervalSeconds', '') ~ '^[1-9][0-9]*$' then (v_touch ->> 'renewalIntervalSeconds')::integer else null end;
        v_satisfaction_key := 'workflow:' || v_event.id::text || ':state:' || v_state.id::text || ':touch:' || v_touch_index::text;

        insert into atlas.rhythm_satisfactions (
          organization_id, farm_id, rhythm_state_id, rhythm_binding_id, rhythm_rule_id,
          rhythm_key, subject_kind, subject_id, satisfaction_key, satisfaction_kind,
          satisfied_at, renewal_interval_seconds, source_kind, source_id, source_event,
          source_workflow_event_id, source_task_id, source_field_log_id, source_object_id,
          source_crop_cycle_id, source_project_id, policy_match, evidence, created_by_user_id
        ) values (
          v_state.organization_id, v_state.farm_id, v_state.id, v_state.rhythm_binding_id,
          v_rule.id, v_state.rhythm_key, v_state.subject_kind, v_state.subject_id,
          v_satisfaction_key, v_satisfaction_kind, v_event.created_at, v_renewal_seconds,
          v_event.source_kind, v_event.source_id, v_event.source_event, v_event.id,
          v_source_task_id, v_source_field_log_id, v_source_object_id,
          v_source_crop_cycle_id, v_source_project_id,
          jsonb_build_object('touchIndex', v_touch_index, 'touch', v_touch),
          jsonb_build_object('workflowPayload', v_event.payload),
          v_actor_user_id
        )
        on conflict (farm_id, satisfaction_key) do nothing
        returning id into v_satisfaction_id;

        if v_satisfaction_id is null then
          select id into v_satisfaction_id
          from atlas.rhythm_satisfactions
          where farm_id = v_state.farm_id and satisfaction_key = v_satisfaction_key;
        end if;

        select latest.id into v_latest_satisfaction_id
        from atlas.rhythm_satisfactions latest
        where latest.rhythm_state_id = v_state.id
        order by latest.satisfied_at desc, latest.created_at desc, latest.id desc
        limit 1;

        if v_latest_satisfaction_id = v_satisfaction_id then
          update atlas.rhythm_state
          set last_qualifying_satisfaction_id = v_latest_satisfaction_id,
              recovery_started_at = null,
              current_task_id = case
                when current_task_id is not null and exists (
                  select 1 from atlas.tasks t where t.id = current_task_id and t.status in ('done','skipped','archived')
                ) then null
                else current_task_id
              end,
              current_occurrence_id = case
                when current_task_id is not null and exists (
                  select 1 from atlas.tasks t where t.id = current_task_id and t.status in ('done','skipped','archived')
                ) then null
                else current_occurrence_id
              end,
              updated_at = now()
          where id = v_state.id;

          v_evaluation := atlas.evaluate_rhythm_binding_v1(v_state.id, now(), 'workflow_result');
        end if;
        v_satisfied := v_satisfied + 1;
        exit;
      end if;
    end loop;
  end loop;

  return jsonb_build_object(
    'contractVersion', 'result_rhythm_effects_v1',
    'workflowEventId', v_event.id,
    'matchedPolicies', v_matched,
    'satisfactions', v_satisfied,
    'recovering', v_recovering
  );
end;
$$;

revoke all on function atlas.apply_result_rhythm_effects_v1(uuid)
  from public, anon, authenticated;
