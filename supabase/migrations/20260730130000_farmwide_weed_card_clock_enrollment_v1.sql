-- Broader Clock enrollment: place every active permanent Weed Card under
-- the same Rulebook -> Clock -> Journal -> canonical release path proven by the pilot.
-- Existing card return intervals remain authoritative. Physical weed condition remains observation-only.

do $$
declare
  v_farm_id uuid;
  v_organization_id uuid;
  v_owner_user_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_rule_id uuid;
  v_binding_id uuid;
  v_state_id uuid;
  v_satisfaction_id uuid;
  v_validity_seconds integer;
  v_warning_seconds integer;
  v_grace_seconds integer;
  v_inspection_seconds integer;
  v_work_class text;
  v_block_scope text;
  v_blocked_actions jsonb;
  v_touches jsonb;
  v_routing jsonb;
  r record;
begin
  select f.id, f.organization_id
  into v_farm_id, v_organization_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  select fm.user_id
  into v_owner_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.role = 'owner'
    and fm.active
  order by fm.created_at
  limit 1;

  select fm.id, fm.user_id
  into v_anna_membership_id, v_anna_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id
    and fm.worker_key = 'anna'
    and fm.role = 'farm_hand'
    and fm.active
  order by fm.created_at
  limit 1;

  if v_farm_id is null or v_owner_user_id is null
     or v_anna_membership_id is null or v_anna_user_id is null then
    raise exception 'Elm Farm, its Owner, and Anna are required for broader Weed Card Clock enrollment.'
      using errcode = 'P0002';
  end if;

  for r in
    select
      wc.id as weed_card_id,
      wc.card_key,
      wc.object_id,
      wc.maintenance_object_id,
      mo.normal_return_interval_days,
      mo.last_completed_at,
      mo.guest_facing,
      mo.crop_protective,
      mo.must_precede_task,
      go.stable_key as object_key,
      go.label as object_label,
      go.zone_id
    from atlas.weed_cards wc
    join atlas.maintenance_objects mo on mo.id = wc.maintenance_object_id
    join atlas.growing_objects go on go.id = wc.object_id
    where wc.farm_id = v_farm_id
      and mo.active
      and mo.maintenance_type = 'weed'
      and mo.normal_return_interval_days is not null
      and mo.normal_return_interval_days > 0
      and mo.last_completed_at is not null
      and not exists (
        select 1
        from atlas.rhythm_state existing
        where existing.farm_id = v_farm_id
          and existing.rhythm_key = 'weed_stewardship'
          and existing.subject_kind = 'growing_object'
          and existing.subject_id = wc.object_id
      )
    order by go.stable_key
  loop
    v_validity_seconds := r.normal_return_interval_days * 86400;
    v_warning_seconds := least(
      v_validity_seconds,
      case when coalesce(r.guest_facing, false) then 604800 else 259200 end
    );
    v_grace_seconds := case
      when coalesce(r.guest_facing, false) then 604800
      else 172800
    end;
    v_inspection_seconds := least(v_validity_seconds, 604800);
    v_work_class := case
      when coalesce(r.guest_facing, false) then 'hospitality'
      else 'maintenance'
    end;
    v_block_scope := case
      when coalesce(r.crop_protective, false) or coalesce(r.must_precede_task, false)
        then 'same_subject'
      else 'none'
    end;
    v_blocked_actions := case
      when v_block_scope = 'same_subject'
        then '["bed_prep","sow","direct_sow","plant","transplant","succession"]'::jsonb
      else '[]'::jsonb
    end;

    v_touches := jsonb_build_array(
      jsonb_build_object(
        'sourceKind', 'object',
        'sourceEvent', 'weeded',
        'payloadContains', jsonb_build_object(
          'metadata', jsonb_build_object('transition', 'done')
        ),
        'effect', 'full',
        'label', 'Full weed completion'
      ),
      jsonb_build_object(
        'sourceKind', 'object',
        'sourceEvent', 'weeded_reset',
        'effect', 'full',
        'label', 'Full weed reset'
      ),
      jsonb_build_object(
        'sourceKind', 'maintenance',
        'sourceEvent', 'weed:fully_completed',
        'effect', 'full',
        'label', 'Permanent Weed Card cleared'
      ),
      jsonb_build_object(
        'sourceKind', 'task',
        'sourceEvent', 'done',
        'actionKey', 'weed',
        'effect', 'full',
        'label', 'Weeding task completed'
      ),
      jsonb_build_object(
        'sourceKind', 'task',
        'sourceEvent', 'done',
        'actionKey', 'cultivate',
        'effect', 'full',
        'label', 'Cultivation completed'
      ),
      jsonb_build_object(
        'sourceKind', 'task',
        'sourceEvent', 'done',
        'actionKey', 'mulch',
        'effect', 'modifier',
        'label', 'Mulch changed the return profile'
      ),
      jsonb_build_object(
        'sourceKind', 'field_log',
        'sourceEvents', jsonb_build_array(
          'action:weed',
          'action:weeded',
          'action:cultivate',
          'action:hoe',
          'action:mulch',
          'action:reset'
        ),
        'effect', 'full',
        'label', 'Explicit full field action'
      ),
      jsonb_build_object(
        'sourceKind', 'object',
        'sourceEvent', 'weeded',
        'payloadContains', jsonb_build_object(
          'metadata', jsonb_build_object('transition', 'partial')
        ),
        'effect', 'partial',
        'label', 'Partial weed result'
      ),
      jsonb_build_object(
        'sourceKind', 'maintenance',
        'sourceEvent', 'weed:partially_completed',
        'effect', 'partial',
        'label', 'Permanent Weed Card partial pass'
      ),
      jsonb_build_object(
        'sourceKind', 'task',
        'sourceEvent', 'partial',
        'actionKey', 'weed',
        'effect', 'partial',
        'label', 'Partial weeding task'
      ),
      jsonb_build_object(
        'sourceKind', 'task',
        'sourceEvent', 'done',
        'actionKey', 'weed_inspection_acceptable',
        'effect', 'conditional',
        'renewalIntervalSeconds', v_inspection_seconds,
        'label', 'Acceptable weed inspection'
      ),
      jsonb_build_object(
        'sourceKind', 'field_log',
        'sourceEvent', 'action:weed_inspection_acceptable',
        'effect', 'conditional',
        'renewalIntervalSeconds', v_inspection_seconds,
        'label', 'Acceptable weed inspection'
      )
    );

    v_routing := jsonb_build_object(
      'assignedMembershipId', v_anna_membership_id,
      'assignedUserId', v_anna_user_id,
      'visibilityScope', 'assigned_worker',
      'tone', 'direct_calm_restorative',
      'eventRouting', jsonb_build_object(
        'warning', jsonb_build_object(
          'bell', true,
          'push', false,
          'recipients', jsonb_build_array('assigned_farm_hand')
        ),
        'due', jsonb_build_object(
          'bell', true,
          'push', true,
          'recipients', jsonb_build_array('assigned_farm_hand')
        ),
        'failure', jsonb_build_object(
          'bell', true,
          'push', true,
          'recipients', jsonb_build_array('assigned_farm_hand', 'owner')
        )
      ),
      'priorityContext', case
        when coalesce(r.guest_facing, false)
          then jsonb_build_array('guest_facing', 'hospitality_presentability')
        else jsonb_build_array('crop_protective', 'production_readiness')
      end
    );

    insert into atlas.rhythm_rules (
      organization_id,
      farm_id,
      rule_key,
      rhythm_key,
      version,
      label,
      status,
      applicability,
      validity_interval_seconds,
      warning_window_seconds,
      grace_window_seconds,
      qualifying_touches,
      failure_consequence,
      player_routing,
      created_by_user_id,
      activated_at,
      owner_reason,
      metadata
    ) values (
      v_organization_id,
      v_farm_id,
      'elm_weed_card_' || r.object_key,
      'weed_stewardship',
      1,
      r.object_label || ' weed rhythm',
      'active',
      jsonb_build_object(
        'subjectKind', 'growing_object',
        'objectStableKey', r.object_key,
        'weedCardId', r.weed_card_id,
        'maintenanceObjectId', r.maintenance_object_id,
        'enrollmentKey', 'elm_farmwide_weed_cards_v1'
      ),
      v_validity_seconds,
      v_warning_seconds,
      v_grace_seconds,
      v_touches,
      jsonb_build_object(
        'dueTask', jsonb_build_object(
          'title', 'Weed ' || r.object_label,
          'taskType', 'maintenance',
          'actionKey', 'weed',
          'workClass', v_work_class,
          'priority', 'normal',
          'visibilityScope', 'assigned_worker'
        ),
        'failureTask', jsonb_build_object(
          'title', 'Restore ' || r.object_label,
          'taskType', 'maintenance',
          'actionKey', 'weed',
          'workClass', v_work_class,
          'priority', 'high',
          'visibilityScope', 'assigned_worker',
          'note', 'The Weed Card return interval expired without a qualifying clear or acceptable inspection.'
        ),
        'blocksActionKeys', v_blocked_actions,
        'blockScope', v_block_scope,
        'blockBeginsAt', 'failure',
        'restoreRequired', true,
        'physicalConditionClaim', 'unknown_until_observed',
        'consequenceVersion', 'elm_farmwide_weed_cards_v1'
      ),
      v_routing,
      v_owner_user_id,
      now(),
      'Broader Clock enrollment adopted this permanent Weed Card''s existing return interval.',
      jsonb_build_object(
        'enrollmentKey', 'elm_farmwide_weed_cards_v1',
        'sourceIntervalDays', r.normal_return_interval_days,
        'sourceIntervalField', 'maintenance_objects.normal_return_interval_days',
        'warningProfile', case
          when coalesce(r.guest_facing, false) then 'guest_facing_7d'
          else 'working_3d'
        end,
        'graceProfile', case
          when coalesce(r.guest_facing, false) then 'guest_facing_7d'
          else 'working_2d'
        end,
        'timezoneName', 'America/Chicago',
        'boundaryMode', 'exact_timestamp',
        'physicalConditionAuthority', 'observation_only',
        'usesLaborTime', false
      )
    )
    on conflict (farm_id, rule_key, version) do update
      set label = excluded.label,
          status = 'active',
          applicability = excluded.applicability,
          validity_interval_seconds = excluded.validity_interval_seconds,
          warning_window_seconds = excluded.warning_window_seconds,
          grace_window_seconds = excluded.grace_window_seconds,
          qualifying_touches = excluded.qualifying_touches,
          failure_consequence = excluded.failure_consequence,
          player_routing = excluded.player_routing,
          activated_at = coalesce(atlas.rhythm_rules.activated_at, excluded.activated_at),
          retired_at = null,
          owner_reason = excluded.owner_reason,
          metadata = atlas.rhythm_rules.metadata || excluded.metadata,
          updated_at = now()
    returning id into v_rule_id;

    insert into atlas.rhythm_bindings (
      organization_id,
      farm_id,
      rhythm_rule_id,
      binding_key,
      inheritance_layer,
      subject_kind,
      subject_id,
      priority,
      active_from,
      active,
      created_by_user_id,
      owner_reason,
      metadata
    ) values (
      v_organization_id,
      v_farm_id,
      v_rule_id,
      'elm_weed_card_' || r.object_key || '_subject',
      'subject_override',
      'growing_object',
      r.object_id,
      80,
      now(),
      true,
      v_owner_user_id,
      'Permanent Weed Card enrolled in the Owner-authored Clock.',
      jsonb_build_object(
        'enrollmentKey', 'elm_farmwide_weed_cards_v1',
        'weedCardId', r.weed_card_id,
        'maintenanceObjectId', r.maintenance_object_id
      )
    )
    on conflict (farm_id, binding_key) do update
      set rhythm_rule_id = excluded.rhythm_rule_id,
          inheritance_layer = excluded.inheritance_layer,
          subject_kind = excluded.subject_kind,
          subject_id = excluded.subject_id,
          subject_key = null,
          priority = excluded.priority,
          active_from = coalesce(atlas.rhythm_bindings.active_from, excluded.active_from),
          active_until = null,
          active = true,
          owner_reason = excluded.owner_reason,
          metadata = atlas.rhythm_bindings.metadata || excluded.metadata,
          updated_at = now()
    returning id into v_binding_id;

    insert into atlas.rhythm_state (
      organization_id,
      farm_id,
      rhythm_binding_id,
      rhythm_rule_id,
      rhythm_key,
      subject_kind,
      subject_id,
      state,
      effective_rule_version,
      visibility_scope,
      assigned_user_id,
      metadata
    ) values (
      v_organization_id,
      v_farm_id,
      v_binding_id,
      v_rule_id,
      'weed_stewardship',
      'growing_object',
      r.object_id,
      'uninitialized',
      1,
      'assigned_worker',
      v_anna_user_id,
      jsonb_build_object(
        'enrollmentKey', 'elm_farmwide_weed_cards_v1',
        'weedCardId', r.weed_card_id,
        'maintenanceObjectId', r.maintenance_object_id,
        'usesMigrationTimeAsSatisfaction', false,
        'physicalConditionAtEnrollment', 'not_inferred'
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
      renewal_interval_seconds,
      source_kind,
      source_id,
      source_event,
      source_object_id,
      policy_match,
      evidence,
      created_by_user_id
    ) values (
      v_organization_id,
      v_farm_id,
      v_state_id,
      v_binding_id,
      v_rule_id,
      'weed_stewardship',
      'growing_object',
      r.object_id,
      'weed-card-enrollment:' || r.weed_card_id::text || ':' ||
        extract(epoch from r.last_completed_at)::bigint::text,
      'game_master',
      r.last_completed_at,
      null,
      'maintenance',
      r.maintenance_object_id,
      'owner_approved_existing_completion',
      r.object_id,
      jsonb_build_object(
        'effect', 'game_master',
        'source', 'maintenance_objects.last_completed_at'
      ),
      jsonb_build_object(
        'weedCardId', r.weed_card_id,
        'maintenanceObjectId', r.maintenance_object_id,
        'lastCompletedAt', r.last_completed_at,
        'usesMigrationTimeAsSatisfaction', false,
        'physicalConditionAtEnrollment', 'not_inferred'
      ),
      v_owner_user_id
    )
    on conflict (farm_id, satisfaction_key) do update
      set evidence = atlas.rhythm_satisfactions.evidence || excluded.evidence
    returning id into v_satisfaction_id;

    update atlas.rhythm_state
    set last_qualifying_satisfaction_id = v_satisfaction_id,
        metadata = metadata || jsonb_build_object(
          'weedCardId', r.weed_card_id,
          'maintenanceObjectId', r.maintenance_object_id
        ),
        updated_at = now()
    where id = v_state_id;

    update atlas.weed_cards
    set metadata = metadata || jsonb_build_object(
          'rhythmClockGoverned', true,
          'rhythmKey', 'weed_stewardship',
          'rhythmStateId', v_state_id,
          'rhythmRuleId', v_rule_id,
          'rhythmBindingId', v_binding_id,
          'clockEnrollmentKey', 'elm_farmwide_weed_cards_v1',
          'laborTimeGovernsClock', false
        ),
        updated_at = now()
    where id = r.weed_card_id;

    update atlas.maintenance_objects
    set active = false,
        metadata = metadata || jsonb_build_object(
          'rhythm_clock_governed', true,
          'rhythm_key', 'weed_stewardship',
          'rhythm_state_id', v_state_id,
          'legacy_scheduler_retired_at', now(),
          'legacy_scheduler_retired_reason', 'Permanent Weed Card moved to Owner-authored Rulebook and Clock'
        ),
        updated_at = now()
    where id = r.maintenance_object_id;
  end loop;
end;
$$;

do $$
declare
  r record;
begin
  for r in
    select state.id
    from atlas.rhythm_state state
    where state.metadata ->> 'enrollmentKey' = 'elm_farmwide_weed_cards_v1'
    order by state.id
  loop
    perform atlas.evaluate_rhythm_binding_v1(
      r.id,
      now(),
      'farmwide_weed_card_enrollment'
    );
  end loop;
end;
$$;

update atlas.weed_cards card
set next_review_on = (state.due_at at time zone 'America/Chicago')::date,
    metadata = card.metadata || jsonb_build_object(
      'nextReviewSource', 'rulebook_clock',
      'clockState', state.state,
      'clockDueAt', state.due_at,
      'clockFailureAt', state.failure_at
    ),
    updated_at = now()
from atlas.rhythm_state state
where state.subject_kind = 'growing_object'
  and state.subject_id = card.object_id
  and state.rhythm_key = 'weed_stewardship'
  and card.metadata ->> 'clockEnrollmentKey' = 'elm_farmwide_weed_cards_v1';

create or replace function atlas.weed_card_clock_v1(
  p_card_id uuid,
  p_as_of timestamptz default now()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_card atlas.weed_cards%rowtype;
  v_maintenance atlas.maintenance_objects%rowtype;
  v_state atlas.rhythm_state%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
  v_next_boundary timestamptz;
begin
  select card.* into v_card
  from atlas.weed_cards card
  where card.id = p_card_id;

  if v_card.id is null then
    return null;
  end if;

  if not atlas.is_farm_member(v_card.farm_id) then
    raise exception 'This Weed Card is outside the current farm membership.'
      using errcode = '42501';
  end if;

  select maintenance.* into v_maintenance
  from atlas.maintenance_objects maintenance
  where maintenance.id = v_card.maintenance_object_id;

  select state.* into v_state
  from atlas.rhythm_state state
  where state.farm_id = v_card.farm_id
    and state.rhythm_key = 'weed_stewardship'
    and state.subject_kind = 'growing_object'
    and state.subject_id = v_card.object_id;

  if v_state.id is null then
    return jsonb_build_object(
      'contractVersion', 'weed_card_clock_v1',
      'cardId', v_card.id,
      'enrolled', false,
      'physicalCondition', jsonb_build_object(
        'known', v_maintenance.condition_reported_at is not null,
        'value', case
          when v_maintenance.condition_reported_at is not null then v_maintenance.condition
          else null
        end,
        'reportedAt', v_maintenance.condition_reported_at,
        'inferredFromClock', false
      )
    );
  end if;

  select rule.* into v_rule
  from atlas.rhythm_rules rule
  where rule.id = v_state.rhythm_rule_id;

  select binding.* into v_binding
  from atlas.rhythm_bindings binding
  where binding.id = v_state.rhythm_binding_id;

  v_next_boundary := case v_state.state
    when 'resting' then coalesce(v_state.warning_at, v_state.due_at)
    when 'coming_due' then v_state.due_at
    when 'due' then v_state.failure_at
    else null
  end;

  return jsonb_build_object(
    'contractVersion', 'weed_card_clock_v1',
    'cardId', v_card.id,
    'enrolled', true,
    'asOf', coalesce(p_as_of, now()),
    'stateId', v_state.id,
    'state', v_state.state,
    'leaseStartedAt', v_state.lease_started_at,
    'warningAt', v_state.warning_at,
    'dueAt', v_state.due_at,
    'failureAt', v_state.failure_at,
    'nextBoundaryAt', v_next_boundary,
    'currentTaskId', v_state.current_task_id,
    'currentOccurrenceId', v_state.current_occurrence_id,
    'rule', jsonb_build_object(
      'ruleId', v_rule.id,
      'ruleKey', v_rule.rule_key,
      'version', v_rule.version,
      'label', v_rule.label,
      'validityIntervalSeconds', v_rule.validity_interval_seconds,
      'warningWindowSeconds', v_rule.warning_window_seconds,
      'graceWindowSeconds', v_rule.grace_window_seconds,
      'ownerReason', v_rule.owner_reason
    ),
    'binding', jsonb_build_object(
      'bindingId', v_binding.id,
      'bindingKey', v_binding.binding_key,
      'inheritanceLayer', v_binding.inheritance_layer,
      'active', v_binding.active
    ),
    'physicalCondition', jsonb_build_object(
      'known', v_maintenance.condition_reported_at is not null,
      'value', case
        when v_maintenance.condition_reported_at is not null then v_maintenance.condition
        else null
      end,
      'reportedAt', v_maintenance.condition_reported_at,
      'source', case
        when v_maintenance.condition_reported_at is not null then v_maintenance.estimate_source
        else null
      end,
      'inferredFromClock', false
    ),
    'explanation', jsonb_build_object(
      'governedBy', 'owner_authored_rule',
      'basis', 'latest_qualifying_satisfaction_plus_existing_weed_card_interval',
      'legacyGenericRecurrenceActive', v_maintenance.active,
      'laborTimeGovernsClock', false,
      'physicalConditionAuthority', 'observation_only'
    )
  );
end;
$$;

revoke all on function atlas.weed_card_clock_v1(uuid, timestamptz) from public;
grant execute on function atlas.weed_card_clock_v1(uuid, timestamptz)
  to authenticated, service_role;
