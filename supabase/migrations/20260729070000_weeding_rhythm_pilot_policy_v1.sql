-- Build 4: bounded Elm Farm weeding rhythm pilot.
-- The Owner approved these subjects and timings on July 28, 2026.
-- Only their legacy generic recurrence is retired; the visible UI is unchanged.

do $$
declare
  v_farm_id uuid;
  v_organization_id uuid;
  v_owner_user_id uuid;
  v_anna_membership_id uuid;
  v_anna_user_id uuid;
  v_object_id uuid;
  v_maintenance_id uuid;
  v_rule_id uuid;
  v_touches jsonb;
  v_routing jsonb;
  r record;
begin
  select f.id, f.organization_id
  into v_farm_id, v_organization_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  select fm.user_id into v_owner_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id and fm.role = 'owner' and fm.active
  order by fm.created_at limit 1;

  select fm.id, fm.user_id
  into v_anna_membership_id, v_anna_user_id
  from atlas.farm_memberships fm
  join atlas.user_profiles up on up.user_id = fm.user_id
  where fm.farm_id = v_farm_id
    and fm.role = 'farm_hand'
    and fm.active
    and lower(up.display_name) = 'anna'
  order by fm.created_at limit 1;

  if v_farm_id is null or v_owner_user_id is null
     or v_anna_membership_id is null or v_anna_user_id is null then
    raise exception 'Elm Farm, its Owner, and Anna are required for the approved pilot.' using errcode = 'P0002';
  end if;

  for r in
    select * from (values
      (
        'fr_8'::text,
        'elm_weeding_fr8'::text,
        'elm_weeding_fr8_subject'::text,
        'fast_production_soil'::text,
        1512000::integer,
        259200::integer,
        172800::integer,
        604800::integer,
        'Field Row 8 weed rhythm'::text,
        'Maintain Field Row 8'::text,
        'Restore Field Row 8'::text,
        'maintenance'::text,
        'Inspect or restore Field Row 8 before its weed-stewardship lease expires.'::text,
        'Restore Field Row 8 to renew its weed-stewardship lease.'::text,
        'Keeps Field Row 8 ready for valid crop and succession moves.'::text,
        'Required before related bed-preparation, planting, or succession moves can unlock.'::text,
        '["bed_prep","sow","direct_sow","plant","transplant","succession"]'::jsonb,
        'same_subject'::text,
        false::boolean
      ),
      (
        'fr_15'::text,
        'elm_weeding_fr15'::text,
        'elm_weeding_fr15_subject'::text,
        'fast_production_soil'::text,
        1512000::integer,
        259200::integer,
        172800::integer,
        604800::integer,
        'Field Row 15 weed rhythm'::text,
        'Maintain Field Row 15'::text,
        'Restore Field Row 15'::text,
        'maintenance'::text,
        'Inspect or restore Field Row 15 before its weed-stewardship lease expires.'::text,
        'Restore Field Row 15 to renew its weed-stewardship lease.'::text,
        'Keeps Field Row 15 ready for valid crop and succession moves.'::text,
        'Required before related bed-preparation, planting, or succession moves can unlock.'::text,
        '["bed_prep","sow","direct_sow","plant","transplant","succession"]'::jsonb,
        'same_subject'::text,
        false::boolean
      ),
      (
        'redbud_island_right'::text,
        'elm_weeding_north_redbud_island'::text,
        'elm_weeding_north_redbud_subject'::text,
        'mulched_ornamental'::text,
        3888000::integer,
        604800::integer,
        604800::integer,
        1209600::integer,
        'North Redbud Island weed rhythm'::text,
        'Maintain North Redbud Island'::text,
        'Restore North Redbud Island'::text,
        'hospitality'::text,
        'Inspect, weed, or refresh mulch in North Redbud Island before its ornamental-bed lease expires.'::text,
        'Restore North Redbud Island as guest-facing work.'::text,
        'Keeps this guest-facing island readable and intentional.'::text,
        'Restores hospitality presentation without blocking unrelated crop production.'::text,
        '[]'::jsonb,
        'none'::text,
        true::boolean
      )
    ) as approved(
      object_key, rule_key, binding_key, rule_class,
      validity_seconds, warning_seconds, grace_seconds, inspection_seconds,
      rule_label, due_title, failure_title, work_class,
      due_note, failure_note, due_unlock, failure_unlock,
      blocked_action_keys, block_scope, guest_facing_escalation
    )
  loop
    select object.id into v_object_id
    from atlas.growing_objects object
    where object.farm_id = v_farm_id and object.stable_key = r.object_key;

    select maintenance.id into v_maintenance_id
    from atlas.maintenance_objects maintenance
    where maintenance.farm_id = v_farm_id
      and maintenance.object_id = v_object_id
      and maintenance.maintenance_type = 'weed'
    order by maintenance.active desc, maintenance.created_at
    limit 1;

    if v_object_id is null or v_maintenance_id is null then
      raise exception 'Pilot object or canonical weed memory is missing for %.', r.object_key using errcode = 'P0002';
    end if;

    v_touches := jsonb_build_array(
      jsonb_build_object(
        'sourceKind', 'object', 'sourceEvent', 'weeded',
        'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'done')),
        'effect', 'full', 'label', 'Full weed completion'
      ),
      jsonb_build_object(
        'sourceKind', 'object', 'sourceEvent', 'weeded_reset',
        'effect', 'full', 'label', 'Full weed reset'
      ),
      jsonb_build_object(
        'sourceKind', 'maintenance', 'sourceEvent', 'weed:fully_completed',
        'effect', 'full', 'label', 'Maintenance completion'
      ),
      jsonb_build_object(
        'sourceKind', 'task', 'sourceEvent', 'done', 'actionKey', 'weed',
        'effect', 'full', 'label', 'Weeding task completed'
      ),
      jsonb_build_object(
        'sourceKind', 'task', 'sourceEvent', 'done',
        'actionKey', case when r.rule_class = 'mulched_ornamental' then 'mulch' else 'cultivate' end,
        'effect', 'full', 'label', case when r.rule_class = 'mulched_ornamental' then 'Fresh mulch completed' else 'Cultivation completed' end
      ),
      jsonb_build_object(
        'sourceKind', 'field_log',
        'sourceEvents', case when r.rule_class = 'mulched_ornamental'
          then jsonb_build_array('action:weed','action:weeded','action:mulch','action:reset')
          else jsonb_build_array('action:weed','action:weeded','action:cultivate','action:hoe','action:mulch','action:reset')
        end,
        'effect', 'full', 'label', 'Explicit full field action'
      ),
      jsonb_build_object(
        'sourceKind', 'object', 'sourceEvent', 'weeded',
        'payloadContains', jsonb_build_object('metadata', jsonb_build_object('transition', 'partial')),
        'effect', 'partial', 'label', 'Partial weed result'
      ),
      jsonb_build_object(
        'sourceKind', 'maintenance', 'sourceEvent', 'weed:partially_completed',
        'effect', 'partial', 'label', 'Partial maintenance result'
      ),
      jsonb_build_object(
        'sourceKind', 'task', 'sourceEvent', 'partial', 'actionKey', 'weed',
        'effect', 'partial', 'label', 'Partial weeding task'
      ),
      jsonb_build_object(
        'sourceKind', 'task', 'sourceEvent', 'done',
        'actionKey', 'weed_inspection_acceptable', 'effect', 'conditional',
        'renewalIntervalSeconds', r.inspection_seconds,
        'label', 'Acceptable weed inspection'
      ),
      jsonb_build_object(
        'sourceKind', 'field_log', 'sourceEvent', 'action:weed_inspection_acceptable',
        'effect', 'conditional', 'renewalIntervalSeconds', r.inspection_seconds,
        'label', 'Acceptable weed inspection'
      )
    );

    v_routing := jsonb_build_object(
      'assignedMembershipId', v_anna_membership_id,
      'assignedUserId', v_anna_user_id,
      'visibilityScope', 'assigned_worker',
      'tone', 'direct_calm_restorative',
      'eventRouting', jsonb_build_object(
        'warning', jsonb_build_object('bell', true, 'push', false, 'recipients', jsonb_build_array('assigned_farm_hand')),
        'due', jsonb_build_object('bell', true, 'push', true, 'recipients', jsonb_build_array('assigned_farm_hand')),
        'failure', jsonb_build_object('bell', true, 'push', true, 'recipients', jsonb_build_array('assigned_farm_hand','owner'))
      ),
      'priorityContext', case when r.guest_facing_escalation
        then jsonb_build_array('guest_facing','hospitality_presentability')
        else jsonb_build_array('crop_protective','production_readiness')
      end
    );

    insert into atlas.rhythm_rules (
      organization_id, farm_id, rule_key, rhythm_key, version, label, status,
      applicability, validity_interval_seconds, warning_window_seconds,
      grace_window_seconds, qualifying_touches, failure_consequence,
      player_routing, created_by_user_id, activated_at, owner_reason, metadata
    ) values (
      v_organization_id, v_farm_id, r.rule_key, 'weed_stewardship', 1,
      r.rule_label, 'active',
      jsonb_build_object(
        'subjectKind', 'growing_object', 'objectStableKey', r.object_key,
        'ruleClass', r.rule_class, 'pilotKey', 'elm_weeding_pilot_v1'
      ),
      r.validity_seconds, r.warning_seconds, r.grace_seconds, v_touches,
      jsonb_build_object(
        'dueTask', jsonb_build_object(
          'title', r.due_title, 'taskType', 'maintenance', 'actionKey', 'weed',
          'workClass', r.work_class, 'priority', 'normal',
          'visibilityScope', 'assigned_worker', 'note', r.due_note,
          'unlockText', r.due_unlock
        ),
        'failureTask', jsonb_build_object(
          'title', r.failure_title, 'taskType', 'maintenance', 'actionKey', 'weed',
          'workClass', r.work_class, 'priority', 'high',
          'visibilityScope', 'assigned_worker', 'note', r.failure_note,
          'unlockText', r.failure_unlock
        ),
        'blocksActionKeys', r.blocked_action_keys,
        'blockScope', r.block_scope,
        'blockBeginsAt', 'failure',
        'restoreRequired', true,
        'guestFacingEscalation', r.guest_facing_escalation,
        'physicalConditionClaim', 'unknown_until_observed',
        'consequenceVersion', 'weeding_pilot_v1'
      ),
      v_routing,
      v_owner_user_id,
      now(),
      'Owner approved the bounded Build 4 defaults on July 28, 2026.',
      jsonb_build_object(
        'pilotKey', 'elm_weeding_pilot_v1', 'ruleClass', r.rule_class,
        'timezoneName', 'America/Chicago', 'boundaryMode', 'exact_timestamp',
        'acceptedInspectionSeconds', r.inspection_seconds,
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
    returning id into v_rule_id;

    insert into atlas.rhythm_bindings (
      organization_id, farm_id, rhythm_rule_id, binding_key,
      inheritance_layer, subject_kind, subject_id, priority,
      active_from, active, created_by_user_id, owner_reason, metadata
    ) values (
      v_organization_id, v_farm_id, v_rule_id, r.binding_key,
      'subject_override', 'growing_object', v_object_id, 100,
      now(), true, v_owner_user_id,
      'Owner-approved Build 4 pilot subject.',
      jsonb_build_object('pilotKey','elm_weeding_pilot_v1','objectStableKey',r.object_key)
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

    update atlas.maintenance_objects maintenance
    set active = false,
        metadata = coalesce(maintenance.metadata,'{}'::jsonb) || jsonb_build_object(
          'rhythm_clock_governed', true,
          'rhythm_key', 'weed_stewardship',
          'rhythm_pilot_key', 'elm_weeding_pilot_v1',
          'legacy_scheduler_retired_at', now(),
          'legacy_scheduler_retired_reason', 'Owner-authored Rulebook and Clock pilot'
        ),
        updated_at = now()
    where maintenance.id = v_maintenance_id;

    update atlas.planned_work_occurrences occurrence
    set state = 'cancelled',
        metadata = coalesce(occurrence.metadata,'{}'::jsonb) || jsonb_build_object(
          'cancelled_by','weeding_rhythm_pilot_v1',
          'cancelled_at',now(),
          'cancelled_reason','Subject is governed by the Owner-authored Clock.'
        ),
        updated_at = now()
    where occurrence.farm_id = v_farm_id
      and occurrence.source_kind = 'maintenance_weeding_collection'
      and occurrence.source_id = v_maintenance_id
      and occurrence.state in ('planned','eligible','failed','releasing');

    update atlas.tasks task
    set status = 'archived',
        metadata = coalesce(task.metadata,'{}'::jsonb) || jsonb_build_object(
          'archived_by','weeding_rhythm_pilot_v1',
          'archived_at',now(),
          'archived_reason','Replaced by Owner-authored Clock governance.'
        ),
        updated_at = now()
    where task.farm_id = v_farm_id
      and task.status in ('open','blocked')
      and task.generated_from = 'maintenance_weeding_collection'
      and exists (
        select 1 from atlas.task_objects task_object
        where task_object.task_id = task.id and task_object.object_id = v_object_id
      );
  end loop;
end;
$$;