-- Enroll the approved pilot subjects with their existing canonical maintenance
-- completion memory as the first lease evidence. No fresh physical condition is
-- inferred from the migration date.

do $$
declare
  v_farm_id uuid;
  v_organization_id uuid;
  v_owner_user_id uuid;
  v_anna_user_id uuid;
  v_subject record;
  v_rule_id uuid;
  v_binding_id uuid;
  v_state_id uuid;
  v_satisfaction_id uuid;
  v_latest_satisfaction_id uuid;
  v_maintenance_id uuid;
  v_last_completed_at timestamptz;
  v_evaluation jsonb;
begin
  select f.id, f.organization_id
  into v_farm_id, v_organization_id
  from atlas.farms f
  where f.stable_key = 'elm_farm';

  select fm.user_id
  into v_owner_user_id
  from atlas.farm_memberships fm
  where fm.farm_id = v_farm_id and fm.role = 'owner' and fm.active
  order by fm.created_at
  limit 1;

  select fm.user_id
  into v_anna_user_id
  from atlas.farm_memberships fm
  join atlas.user_profiles up on up.user_id = fm.user_id
  where fm.farm_id = v_farm_id
    and fm.role = 'farm_hand'
    and fm.active
    and lower(up.display_name) = 'anna'
  order by fm.created_at
  limit 1;

  if v_farm_id is null or v_owner_user_id is null or v_anna_user_id is null then
    raise exception 'Elm Farm, its Owner, and Anna are required for pilot enrollment.' using errcode = 'P0002';
  end if;

  for v_subject in
    select *
    from (values
      ('fr_8'::text, 'elm_weeding_fr8'::text, 'elm_weeding_fr8_subject'::text, 'fast_production_soil'::text),
      ('fr_15'::text, 'elm_weeding_fr15'::text, 'elm_weeding_fr15_subject'::text, 'fast_production_soil'::text),
      ('redbud_island_right'::text, 'elm_weeding_north_redbud_island'::text, 'elm_weeding_north_redbud_subject'::text, 'mulched_ornamental'::text)
    ) as approved(object_key, rule_key, binding_key, rule_class)
  loop
    select rule.id into v_rule_id
    from atlas.rhythm_rules rule
    where rule.farm_id = v_farm_id
      and rule.rule_key = v_subject.rule_key
      and rule.version = 1
      and rule.status = 'active';

    select binding.id into v_binding_id
    from atlas.rhythm_bindings binding
    where binding.farm_id = v_farm_id
      and binding.binding_key = v_subject.binding_key
      and binding.active;

    select maintenance.id, maintenance.last_completed_at
    into v_maintenance_id, v_last_completed_at
    from atlas.growing_objects object
    join atlas.maintenance_objects maintenance
      on maintenance.object_id = object.id
     and maintenance.maintenance_type = 'weed'
    where object.farm_id = v_farm_id
      and object.stable_key = v_subject.object_key
    order by maintenance.created_at
    limit 1;

    if v_rule_id is null or v_binding_id is null or v_maintenance_id is null or v_last_completed_at is null then
      raise exception 'Pilot enrollment is missing rule, binding, or completion evidence for %.', v_subject.object_key using errcode = 'P0002';
    end if;

    insert into atlas.rhythm_state (
      organization_id, farm_id, rhythm_binding_id, rhythm_rule_id, rhythm_key,
      subject_kind, subject_id, effective_rule_version, visibility_scope,
      assigned_user_id, metadata
    )
    select
      v_organization_id,
      v_farm_id,
      v_binding_id,
      v_rule_id,
      'weed_stewardship',
      'growing_object',
      object.id,
      1,
      'assigned_worker',
      v_anna_user_id,
      jsonb_build_object(
        'pilotKey', 'elm_weeding_pilot_v1',
        'objectStableKey', v_subject.object_key,
        'ruleClass', v_subject.rule_class,
        'enrollmentSource', 'owner_approved_build_4_defaults',
        'physicalConditionAuthority', 'observation_only',
        'timeDoesNotClaimPhysicalWeedPressure', true
      )
    from atlas.growing_objects object
    where object.farm_id = v_farm_id and object.stable_key = v_subject.object_key
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
      organization_id, farm_id, rhythm_state_id, rhythm_binding_id, rhythm_rule_id,
      rhythm_key, subject_kind, subject_id, satisfaction_key, satisfaction_kind,
      satisfied_at, source_kind, source_id, source_event, source_object_id,
      policy_match, evidence, created_by_user_id
    )
    select
      v_organization_id,
      v_farm_id,
      v_state_id,
      v_binding_id,
      v_rule_id,
      'weed_stewardship',
      'growing_object',
      object.id,
      'pilot-baseline:' || v_subject.object_key || ':' || extract(epoch from v_last_completed_at)::bigint::text,
      'game_master',
      v_last_completed_at,
      'maintenance_state',
      v_maintenance_id,
      'owner_approved_existing_completion',
      object.id,
      jsonb_build_object(
        'policy', 'owner_approved_existing_completion_v1',
        'ruleClass', v_subject.rule_class,
        'usesMigrationTimeAsSatisfaction', false
      ),
      jsonb_build_object(
        'maintenanceObjectId', v_maintenance_id,
        'lastCompletedAt', v_last_completed_at,
        'evidenceSource', 'atlas.maintenance_objects.last_completed_at',
        'ownerApprovedDecision', 'approved_defaults_2026_07_28',
        'confidence', 'existing_canonical_state',
        'physicalConditionAtEnrollment', 'not_inferred'
      ),
      v_owner_user_id
    from atlas.growing_objects object
    where object.farm_id = v_farm_id and object.stable_key = v_subject.object_key
    on conflict (farm_id, satisfaction_key) do nothing
    returning id into v_satisfaction_id;

    if v_satisfaction_id is null then
      select satisfaction.id into v_satisfaction_id
      from atlas.rhythm_satisfactions satisfaction
      where satisfaction.farm_id = v_farm_id
        and satisfaction.satisfaction_key = 'pilot-baseline:' || v_subject.object_key || ':' || extract(epoch from v_last_completed_at)::bigint::text;
    end if;

    select satisfaction.id into v_latest_satisfaction_id
    from atlas.rhythm_satisfactions satisfaction
    where satisfaction.rhythm_state_id = v_state_id
    order by satisfaction.satisfied_at desc, satisfaction.created_at desc, satisfaction.id desc
    limit 1;

    update atlas.rhythm_state
    set last_qualifying_satisfaction_id = v_latest_satisfaction_id,
        updated_at = now()
    where id = v_state_id;

    v_evaluation := atlas.evaluate_rhythm_binding_v1(
      v_state_id,
      now(),
      'owner_approved_pilot_enrollment'
    );
  end loop;
end;
$$;