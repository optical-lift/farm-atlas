create or replace function atlas.ensure_rhythm_state_v1(
  p_farm_id uuid,
  p_rhythm_key text,
  p_subject_kind text,
  p_subject_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_resolution jsonb;
  v_rule jsonb;
  v_state_id uuid;
  v_visibility text;
  v_assigned_user_id uuid;
  v_assigned_membership_id uuid;
begin
  if auth.uid() is null or not atlas.is_farm_owner(p_farm_id) then
    raise exception 'Only a farm Owner may enroll a subject in the Clock.' using errcode = '42501';
  end if;

  v_resolution := atlas.resolve_effective_rhythm_rule_v1(
    p_farm_id,
    p_rhythm_key,
    p_subject_kind,
    p_subject_id,
    coalesce(p_as_of, now())
  );
  v_rule := v_resolution -> 'effectiveRule';

  if v_rule is null or jsonb_typeof(v_rule) = 'null' then
    raise exception 'No active effective Rulebook rhythm applies to this subject.' using errcode = 'P0002';
  end if;

  v_visibility := coalesce(nullif(v_rule #>> '{playerRouting,visibilityScope}', ''), 'farm_shared');
  if v_visibility not in ('owner','management','assigned_worker','farm_shared','project_shared','system_internal') then
    v_visibility := 'farm_shared';
  end if;

  if nullif(v_rule #>> '{playerRouting,assignedUserId}', '') is not null then
    v_assigned_user_id := (v_rule #>> '{playerRouting,assignedUserId}')::uuid;
  elsif nullif(v_rule #>> '{playerRouting,assignedMembershipId}', '') is not null then
    v_assigned_membership_id := (v_rule #>> '{playerRouting,assignedMembershipId}')::uuid;
    select fm.user_id into v_assigned_user_id
    from atlas.farm_memberships fm
    where fm.id = v_assigned_membership_id
      and fm.farm_id = p_farm_id
      and fm.active;
  end if;

  insert into atlas.rhythm_state (
    organization_id,
    farm_id,
    rhythm_binding_id,
    rhythm_rule_id,
    rhythm_key,
    subject_kind,
    subject_id,
    effective_rule_version,
    visibility_scope,
    assigned_user_id,
    metadata
  ) values (
    (v_resolution ->> 'organizationId')::uuid,
    p_farm_id,
    (v_rule ->> 'bindingId')::uuid,
    (v_rule ->> 'ruleId')::uuid,
    v_rule ->> 'rhythmKey',
    p_subject_kind,
    p_subject_id,
    (v_rule ->> 'version')::integer,
    v_visibility,
    v_assigned_user_id,
    jsonb_build_object(
      'enrolled_by_user_id', auth.uid(),
      'enrolled_at', now(),
      'resolution', v_resolution -> 'explanation'
    )
  )
  on conflict (farm_id, rhythm_key, subject_kind, subject_id) do update
    set rhythm_binding_id = excluded.rhythm_binding_id,
        rhythm_rule_id = excluded.rhythm_rule_id,
        effective_rule_version = excluded.effective_rule_version,
        visibility_scope = excluded.visibility_scope,
        assigned_user_id = excluded.assigned_user_id,
        metadata = atlas.rhythm_state.metadata || excluded.metadata,
        updated_at = now()
  returning id into v_state_id;

  return jsonb_build_object(
    'contractVersion', 'rhythm_state_enrollment_v1',
    'stateId', v_state_id,
    'farmId', p_farm_id,
    'rhythmKey', p_rhythm_key,
    'subjectKind', p_subject_kind,
    'subjectId', p_subject_id,
    'effectiveRule', v_rule
  );
end;
$$;

revoke all on function atlas.ensure_rhythm_state_v1(uuid, text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function atlas.ensure_rhythm_state_v1(uuid, text, text, uuid, timestamptz)
  to authenticated;

create or replace function atlas.record_rhythm_transition_v1(
  p_state_id uuid,
  p_transition_key text,
  p_transition_kind text,
  p_from_state text,
  p_to_state text,
  p_boundary_kind text,
  p_boundary_at timestamptz,
  p_evaluated_at timestamptz,
  p_satisfaction_id uuid default null,
  p_task_id uuid default null,
  p_planned_occurrence_id uuid default null,
  p_payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_transition_id uuid;
  v_journal_event_id uuid;
  v_event_kind text;
  v_title text;
  v_detail text;
  v_importance text;
  v_object_id uuid;
  v_crop_cycle_id uuid;
  v_project_id uuid;
begin
  select * into v_state from atlas.rhythm_state where id = p_state_id;
  if v_state.id is null then
    raise exception 'Rhythm state not found.' using errcode = 'P0002';
  end if;
  select * into v_rule from atlas.rhythm_rules where id = v_state.rhythm_rule_id;

  insert into atlas.rhythm_transitions (
    organization_id, farm_id, rhythm_state_id, rhythm_binding_id, rhythm_rule_id,
    rhythm_key, subject_kind, subject_id, transition_key, transition_kind,
    from_state, to_state, boundary_kind, boundary_at, evaluated_at,
    satisfaction_id, task_id, planned_occurrence_id, evaluator_version,
    visibility_scope, assigned_user_id, payload
  ) values (
    v_state.organization_id, v_state.farm_id, v_state.id, v_state.rhythm_binding_id,
    v_state.rhythm_rule_id, v_state.rhythm_key, v_state.subject_kind, v_state.subject_id,
    p_transition_key, p_transition_kind, p_from_state, p_to_state, p_boundary_kind,
    p_boundary_at, coalesce(p_evaluated_at, now()), p_satisfaction_id, p_task_id,
    p_planned_occurrence_id, 'rhythm_clock_v1', v_state.visibility_scope,
    v_state.assigned_user_id, coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (farm_id, transition_key) do nothing
  returning id into v_transition_id;

  if v_transition_id is null then
    select id into v_transition_id
    from atlas.rhythm_transitions
    where farm_id = v_state.farm_id and transition_key = p_transition_key;
  end if;

  v_event_kind := case p_transition_kind
    when 'warning' then 'rhythm_warning'
    when 'due' then 'rhythm_due'
    when 'failed' then 'rhythm_failure'
    when 'recovering' then 'rhythm_recovery'
    when 'restored' then 'rhythm_recovery'
    else 'state_change'
  end;
  v_importance := case p_transition_kind
    when 'failed' then 'critical'
    when 'due' then 'attention'
    when 'warning' then 'normal'
    else 'quiet'
  end;
  v_title := coalesce(nullif(v_rule.label, ''), initcap(replace(v_state.rhythm_key, '_', ' '))) ||
    case p_transition_kind
      when 'warning' then ' is coming due'
      when 'due' then ' is due'
      when 'failed' then ' fell out of rhythm'
      when 'recovering' then ' is recovering'
      when 'restored' then ' was restored'
      when 'renewed' then ' was renewed'
      when 'paused' then ' was paused'
      when 'reactivated' then ' was reactivated'
      when 'rule_changed' then ' rule changed'
      else ' entered the Clock'
    end;
  v_detail := 'Clock boundary: ' || p_boundary_kind || ' at ' || p_boundary_at::text;

  if v_state.subject_kind = 'growing_object' then v_object_id := v_state.subject_id; end if;
  if v_state.subject_kind = 'crop_cycle' then
    v_crop_cycle_id := v_state.subject_id;
    select object_id into v_object_id from atlas.crop_cycles where id = v_state.subject_id;
  end if;
  if v_state.subject_kind = 'project' then v_project_id := v_state.subject_id; end if;

  v_journal_event_id := atlas.upsert_journal_event_v1(
    p_organization_id => v_state.organization_id,
    p_farm_id => v_state.farm_id,
    p_event_key => 'rhythm:' || p_transition_key,
    p_event_kind => v_event_kind,
    p_source_kind => 'rhythm_transition',
    p_source_id => v_transition_id,
    p_source_event => p_transition_kind,
    p_occurred_at => p_boundary_at,
    p_journal_date => (p_boundary_at at time zone 'America/Chicago')::date,
    p_title => v_title,
    p_detail => v_detail,
    p_visibility_scope => v_state.visibility_scope,
    p_importance => v_importance,
    p_assigned_user_id => v_state.assigned_user_id,
    p_task_id => p_task_id,
    p_object_id => v_object_id,
    p_crop_cycle_id => v_crop_cycle_id,
    p_project_id => v_project_id,
    p_payload => jsonb_build_object(
      'rhythmStateId', v_state.id,
      'rhythmBindingId', v_state.rhythm_binding_id,
      'rhythmRuleId', v_state.rhythm_rule_id,
      'rhythmKey', v_state.rhythm_key,
      'subjectKind', v_state.subject_kind,
      'subjectId', v_state.subject_id,
      'fromState', p_from_state,
      'toState', p_to_state,
      'boundaryKind', p_boundary_kind,
      'boundaryAt', p_boundary_at,
      'taskId', p_task_id,
      'plannedOccurrenceId', p_planned_occurrence_id
    ) || coalesce(p_payload, '{}'::jsonb),
    p_provenance => jsonb_build_object(
      'adapter', 'rhythm_clock_v1',
      'source_table', 'atlas.rhythm_transitions',
      'transition_id', v_transition_id,
      'transition_key', p_transition_key,
      'evaluator_version', 'rhythm_clock_v1'
    )
  );

  -- Permit only this governed internal link update; ordinary history remains append-only.
  perform set_config('atlas.rhythm_history_internal_write', 'on', true);
  update atlas.rhythm_transitions
  set journal_event_id = v_journal_event_id
  where id = v_transition_id and journal_event_id is null;
  perform set_config('atlas.rhythm_history_internal_write', 'off', true);

  return v_transition_id;
end;
$$;

revoke all on function atlas.record_rhythm_transition_v1(
  uuid, text, text, text, text, text, timestamptz, timestamptz,
  uuid, uuid, uuid, jsonb
) from public, anon, authenticated;
