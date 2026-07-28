-- Build 4: bounded Elm Farm weeding rhythm pilot.
-- The Owner approved these three subjects and timings on July 28, 2026.
-- This migration retires only their legacy generic weeding recurrence and installs
-- explicit Rulebook policies. It does not change the visible Atlas interface.

do $$
declare
  v_farm_id uuid;
  v_organization_id uuid;
  v_owner_user_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_fr8_object_id uuid;
  v_fr15_object_id uuid;
  v_redbud_object_id uuid;
  v_fr8_maintenance_id uuid;
  v_fr15_maintenance_id uuid;
  v_redbud_maintenance_id uuid;
  v_fr8_rule_id uuid;
  v_fr15_rule_id uuid;
  v_redbud_rule_id uuid;
  v_field_touches jsonb;
  v_redbud_touches jsonb;
  v_field_routing jsonb;
  v_redbud_routing jsonb;
begin
  select f.id, f.organization_id
  into v_farm_id, v_organization_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  if v_farm_id is null then
    raise exception 'Elm Farm is required for the approved weeding pilot.' using errcode = 'P0002';
  end if;

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
  join atlas.user_profiles up on up.user_id = fm.user_id
  where fm.farm_id = v_farm_id
    and fm.role = 'farm_hand'
    and fm.active
    and lower(up.display_name) = 'anna'
  order by fm.created_at
  limit 1;

  if v_owner_user_id is null or v_anna_membership_id is null or v_anna_user_id is null then
    raise exception 'The active Elm Owner and Anna farm-hand memberships are required.' using errcode = 'P0002';
  end if;

  select id into v_fr8_object_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'fr_8';

  select id into v_fr15_object_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'fr_15';

  select id into v_redbud_object_id
  from atlas.growing_objects
  where farm_id = v_farm_id and stable_key = 'redbud_island_right';

  if v_fr8_object_id is null or v_fr15_object_id is null or v_redbud_object_id is null then
    raise exception 'FR8, FR15, and North Redbud Island are required for the approved pilot.' using errcode = 'P0002';
  end if;

  select id into v_fr8_maintenance_id
  from atlas.maintenance_objects
  where farm_id = v_farm_id and object_id = v_fr8_object_id and maintenance_type = 'weed'
  order by active desc, created_at
  limit 1;

  select id into v_fr15_maintenance_id
  from atlas.maintenance_objects
  where farm_id = v_farm_id and object_id = v_fr15_object_id and maintenance_type = 'weed'
  order by active desc, created_at
  limit 1;

  select id into v_redbud_maintenance_id
  from atlas.maintenance_objects
  where farm_id = v_farm_id and object_id = v_redbud_object_id and maintenance_type = 'weed'
  order by active desc, created_at
  limit 1;

  if v_fr8_maintenance_id is null or v_fr15_maintenance_id is null or v_redbud_maintenance_id is null then
    raise exception 'Each pilot object must already have canonical weed-maintenance memory.' using errcode = 'P0002';
  end if;

  v_field_touches := jsonb_build_array(
    jsonb_build_object(
      'sourceKind', 'object',
      'sourceEvent', 'weeded',
      'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'done')),
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
      'label', 'Maintenance completion'
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
      'sourceKind', 'field_log',
      'sourceEvents', jsonb_build_array(
        'action:weed', 'action:weeded', 'action:cultivate', 'action:hoe', 'action:mulch', 'action:reset'
      ),
      'effect', 'full',
      'label', 'Explicit full field action'
    ),
    jsonb_build_object(
      'sourceKind', 'object',
      'sourceEvent', 'weeded',
      'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'partial')),
      'effect', 'partial',
      'label', 'Partial weed result'
    ),
    jsonb_build_object(
      'sourceKind', 'maintenance',
      'sourceEvent', 'weed:partially_completed',
      'effect', 'partial',
      'label', 'Partial maintenance result'
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
      'renewalIntervalSeconds', 604800,
      'label', 'Acceptable weed inspection — seven-day extension'
    ),
    jsonb_build_object(
      'sourceKind', 'field_log',
      'sourceEvent', 'action:weed_inspection_acceptable',
      'effect', 'conditional',
      'renewalIntervalSeconds', 604800,
      'label', 'Acceptable weed inspection — seven-day extension'
    )
  );

  v_redbud_touches := jsonb_build_array(
    jsonb_build_object(
      'sourceKind', 'object',
      'sourceEvent', 'weeded',
      'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'done')),
      'effect', 'full',
      'label', 'Full weed completion'
    ),
    jsonb_build_object(
      'sourceKind', 'object',
      'sourceEvent', 'weeded_reset',
      'effect', 'full',
      'label', 'Full ornamental-bed reset'
    ),
    jsonb_build_object(
      'sourceKind', 'maintenance',
      'sourceEvent', 'weed:fully_completed',
      'effect', 'full',
      'label', 'Maintenance completion'
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
      'actionKey', 'mulch',
      'effect', 'full',
      'label', 'Fresh mulch completed'
    ),
    jsonb_build_object(
      'sourceKind', 'field_log',
      'sourceEvents', jsonb_build_array('action:weed', 'action:weeded', 'action:mulch', 'action:reset'),
      'effect', 'full',
      'label', 'Explicit full ornamental-bed action'
    ),
    jsonb_build_object(
      'sourceKind', 'object',
      'sourceEvent', 'weeded',
      'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'partial')),
      'effect', 'partial',
      'label', 'Partial weed result'
    ),
    jsonb_build_object(
      'sourceKind', 'maintenance',
      'sourceEvent', 'weed:partially_completed',
      'effect', 'partial',
      'label', 'Partial maintenance result'
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
      'renewalIntervalSeconds', 1209600,
      'label', 'Acceptable weed inspection — fourteen-day extension'
    ),
    jsonb_build_object(
      'sourceKind', 'field_log',
      'sourceEvent', 'action:weed_inspection_acceptable',
      'effect', 'conditional',
      'renewalIntervalSeconds', 1209600,
      'label', 'Acceptable weed inspection — fourteen-day extension'
    )
  );

  v_field_routing := jsonb_build_object(
    'assignedMembershipId', v_anna_membership_id,
    'assignedUserId', v_anna_user_id,
    'visibilityScope', 'assigned_worker',
    'tone', 'direct_calm_restorative',
    'eventRouting', jsonb_build_object(
      'warning', jsonb_build_object('bell', true, 'push', false, 'recipients', jsonb_build_array('assigned_farm_hand')),
      'due', jsonb_build_object('bell', true, 'push', true, 'recipients', jsonb_build_array('assigned_farm_hand')),
      'failure', jsonb_build_object('bell', true, 'push', true, 'recipients', jsonb_build_array('assigned_farm_hand', 'owner'))
    )
  );

  v_redbud_routing := v_field_routing || jsonb_build_object(
    'priorityContext', jsonb_build_array('guest_facing', 'hospitality_presentability')
  );

  insert into atlas.rhythm_rules (
    organization_id, farm_id, rule_key, rhythm_key, version, label, status,
    applicability, validity_interval_seconds, warning_window_seconds,
    grace_window_seconds, qualifying_touches, failure_consequence,
    player_routing, created_by_user_id, activated_at, owner_reason, metadata
  ) values (
    v_organization_id,
    v_farm_id,
    'elm_weeding_fr8',
    'weed_stewardship',
    1,
    'Field Row 8 weed rhythm',
    'active',
    jsonb_build_object(
      'subjectKind', 'growing_object',
      'objectStableKey', 'fr_8',
      'ruleClass', 'fast_production_soil',
      'pilotKey', 'elm_weeding_pilot_v1'
    ),
    1512000,
    259200,
    172800,
    v_field_touches,
    jsonb_build_object(
      'dueTask', jsonb_build_object(
        'title', 'Maintain Field Row 8',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'maintenance',
        'priority', 'normal',
        'visibilityScope', 'assigned_worker',
        'note', 'Inspect or restore Field Row 8 before its weed-stewardship lease expires.',
        'unlockText', 'Keeps Field Row 8 ready for valid crop and succession moves.'
      ),
      'failureTask', jsonb_build_object(
        'title', 'Restore Field Row 8',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'maintenance',
        'priority', 'high',
        'visibilityScope', 'assigned_worker',
        'note', 'Restore Field Row 8 to renew its weed-stewardship lease.',
        'unlockText', 'Required before related bed-preparation, planting, or succession moves can unlock.'
      ),
      'blocksActionKeys', jsonb_build_array('bed_prep', 'sow', 'direct_sow', 'plant', 'transplant', 'succession'),
      'blockScope', 'same_subject',
      'blockBeginsAt', 'failure',
      'restoreRequired', true,
      'physicalConditionClaim', 'unknown_until_observed',
      'consequenceVersion', 'weeding_pilot_v1'
    ),
    v_field_routing,
    v_owner_user_id,
    now(),
    'Owner approved the bounded Build 4 defaults on July 28, 2026.',
    jsonb_build_object(
      'pilotKey', 'elm_weeding_pilot_v1',
      'ruleClass', 'fast_production_soil',
      'timezoneName', 'America/Chicago',
      'boundaryMode', 'exact_timestamp',
      'acceptedInspectionSeconds', 604800,
      'physicalConditionAuthority', 'observation_only',
      'ownerDecision', 'approved_defaults_2026_07_28'
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
  returning id into v_fr8_rule_id;

  insert into atlas.rhythm_rules (
    organization_id, farm_id, rule_key, rhythm_key, version, label, status,
    applicability, validity_interval_seconds, warning_window_seconds,
    grace_window_seconds, qualifying_touches, failure_consequence,
    player_routing, created_by_user_id, activated_at, owner_reason, metadata
  ) values (
    v_organization_id,
    v_farm_id,
    'elm_weeding_fr15',
    'weed_stewardship',
    1,
    'Field Row 15 weed rhythm',
    'active',
    jsonb_build_object(
      'subjectKind', 'growing_object',
      'objectStableKey', 'fr_15',
      'ruleClass', 'fast_production_soil',
      'pilotKey', 'elm_weeding_pilot_v1'
    ),
    1512000,
    259200,
    172800,
    v_field_touches,
    jsonb_build_object(
      'dueTask', jsonb_build_object(
        'title', 'Maintain Field Row 15',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'maintenance',
        'priority', 'normal',
        'visibilityScope', 'assigned_worker',
        'note', 'Inspect or restore Field Row 15 before its weed-stewardship lease expires.',
        'unlockText', 'Keeps Field Row 15 ready for valid crop and succession moves.'
      ),
      'failureTask', jsonb_build_object(
        'title', 'Restore Field Row 15',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'maintenance',
        'priority', 'high',
        'visibilityScope', 'assigned_worker',
        'note', 'Restore Field Row 15 to renew its weed-stewardship lease.',
        'unlockText', 'Required before related bed-preparation, planting, or succession moves can unlock.'
      ),
      'blocksActionKeys', jsonb_build_array('bed_prep', 'sow', 'direct_sow', 'plant', 'transplant', 'succession'),
      'blockScope', 'same_subject',
      'blockBeginsAt', 'failure',
      'restoreRequired', true,
      'physicalConditionClaim', 'unknown_until_observed',
      'consequenceVersion', 'weeding_pilot_v1'
    ),
    v_field_routing,
    v_owner_user_id,
    now(),
    'Owner approved the bounded Build 4 defaults on July 28, 2026.',
    jsonb_build_object(
      'pilotKey', 'elm_weeding_pilot_v1',
      'ruleClass', 'fast_production_soil',
      'timezoneName', 'America/Chicago',
      'boundaryMode', 'exact_timestamp',
      'acceptedInspectionSeconds', 604800,
      'physicalConditionAuthority', 'observation_only',
      'ownerDecision', 'approved_defaults_2026_07_28'
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
  returning id into v_fr15_rule_id;

  insert into atlas.rhythm_rules (
    organization_id, farm_id, rule_key, rhythm_key, version, label, status,
    applicability, validity_interval_seconds, warning_window_seconds,
    grace_window_seconds, qualifying_touches, failure_consequence,
    player_routing, created_by_user_id, activated_at, owner_reason, metadata
  ) values (
    v_organization_id,
    v_farm_id,
    'elm_weeding_north_redbud_island',
    'weed_stewardship',
    1,
    'North Redbud Island weed rhythm',
    'active',
    jsonb_build_object(
      'subjectKind', 'growing_object',
      'objectStableKey', 'redbud_island_right',
      'ruleClass', 'mulched_ornamental',
      'pilotKey', 'elm_weeding_pilot_v1'
    ),
    3888000,
    604800,
    604800,
    v_redbud_touches,
    jsonb_build_object(
      'dueTask', jsonb_build_object(
        'title', 'Maintain North Redbud Island',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'hospitality',
        'priority', 'normal',
        'visibilityScope', 'assigned_worker',
        'note', 'Inspect, weed, or refresh mulch in North Redbud Island before its ornamental-bed lease expires.',
        'unlockText', 'Keeps this guest-facing island readable and intentional.'
      ),
      'failureTask', jsonb_build_object(
        'title', 'Restore North Redbud Island',
        'taskType', 'maintenance',
        'actionKey', 'weed',
        'workClass', 'hospitality',
        'priority', 'high',
        'visibilityScope', 'assigned_worker',
        'note', 'Restore North Redbud Island as guest-facing work.',
        'unlockText', 'Restores hospitality presentation without blocking unrelated crop production.'
      ),
      'blocksActionKeys', jsonb_build_array(),
      'blockScope', 'none',
      'blockBeginsAt', 'failure',
      'restoreRequired', true,
      'guestFacingEscalation', true,
      'physicalConditionClaim', 'unknown_until_observed',
      'consequenceVersion', 'weeding_pilot_v1'
    ),
    v_redbud_routing,
    v_owner_user_id,
    now(),
    'Owner approved the bounded Build 4 defaults on July 28, 2026.',
    jsonb_build_object(
      'pilotKey', 'elm_weeding_pilot_v1',
      'ruleClass', 'mulched_ornamental',
      'timezoneName', 'America/Chicago',
      'boundaryMode', 'exact_timestamp',
      'acceptedInspectionSeconds', 1209600,
      'physicalConditionAuthority', 'observation_only',
      'ownerDecision', 'approved_defaults_2026_07_28'
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
  returning id into v_redbud_rule_id;

  insert into atlas.rhythm_bindings (
    organization_id, farm_id, rhythm_rule_id, binding_key, inheritance_layer,
    subject_kind, subject_id, priority, active_from, active,
    created_by_user_id, owner_reason, metadata
  ) values
    (
      v_organization_id, v_farm_id, v_fr8_rule_id, 'elm_weeding_fr8_subject',
      'subject_override', 'growing_object', v_fr8_object_id, 100, now(), true,
      v_owner_user_id, 'Owner-approved Build 4 pilot subject.',
      jsonb_build_object('pilotKey', 'elm_weeding_pilot_v1', 'objectStableKey', 'fr_8')
    ),
    (
      v_organization_id, v_farm_id, v_fr15_rule_id, 'elm_weeding_fr15_subject',
      'subject_override', 'growing_object', v_fr15_object_id, 100, now(), true,
      v_owner_user_id, 'Owner-approved Build 4 pilot subject.',
      jsonb_build_object('pilotKey', 'elm_weeding_pilot_v1', 'objectStableKey', 'fr_15')
    ),
    (
      v_organization_id, v_farm_id, v_redbud_rule_id, 'elm_weeding_north_redbud_subject',
      'subject_override', 'growing_object', v_redbud_object_id, 100, now(), true,
      v_owner_user_id, 'Owner-approved Build 4 pilot subject.',
      jsonb_build_object('pilotKey', 'elm_weeding_pilot_v1', 'objectStableKey', 'redbud_island_right')
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
        updated_at = now();

  -- These three objects now answer to the Owner-authored Clock, not the old
  -- generic recurrence preview. Their historical maintenance rows remain as evidence.
  update atlas.maintenance_objects mo
  set active = false,
      metadata = coalesce(mo.metadata, '{}'::jsonb) || jsonb_build_object(
        'rhythm_clock_governed', true,
        'rhythm_key', 'weed_stewardship',
        'rhythm_pilot_key', 'elm_weeding_pilot_v1',
        'legacy_scheduler_retired_at', now(),
        'legacy_scheduler_retired_reason', 'Owner-authored Rulebook and Clock pilot'
      ),
      updated_at = now()
  where mo.id in (v_fr8_maintenance_id, v_fr15_maintenance_id, v_redbud_maintenance_id);

  update atlas.planned_work_occurrences occurrence
  set state = 'cancelled',
      metadata = coalesce(occurrence.metadata, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by', 'weeding_rhythm_pilot_v1',
        'cancelled_at', now(),
        'cancelled_reason', 'Subject is governed by the Owner-authored Clock.'
      ),
      updated_at = now()
  where occurrence.farm_id = v_farm_id
    and occurrence.source_kind = 'maintenance_weeding_collection'
    and occurrence.source_id in (v_fr8_maintenance_id, v_fr15_maintenance_id, v_redbud_maintenance_id)
    and occurrence.state in ('planned', 'eligible', 'failed', 'releasing');

  update atlas.tasks task
  set status = 'archived',
      metadata = coalesce(task.metadata, '{}'::jsonb) || jsonb_build_object(
        'archived_by', 'weeding_rhythm_pilot_v1',
        'archived_at', now(),
        'archived_reason', 'Replaced by Owner-authored Clock governance.'
      ),
      updated_at = now()
  where task.farm_id = v_farm_id
    and task.status in ('open', 'blocked')
    and task.generated_from = 'maintenance_weeding_collection'
    and exists (
      select 1
      from atlas.task_objects task_object
      where task_object.task_id = task.id
        and task_object.object_id in (v_fr8_object_id, v_fr15_object_id, v_redbud_object_id)
    );
end;
$$;