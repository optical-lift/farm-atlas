-- Create five permanent Elm mowing-route subjects and their accepted Clock rules.

do $$
declare
  v_farm atlas.farms%rowtype;
  v_org uuid;
  v_anna atlas.farm_memberships%rowtype;
  v_owner atlas.farm_memberships%rowtype;
  v_route record;
  v_object atlas.growing_objects%rowtype;
  v_rule atlas.rhythm_rules%rowtype;
  v_binding atlas.rhythm_bindings%rowtype;
begin
  select * into v_farm from atlas.farms where stable_key='elm_farm';
  if v_farm.id is null then raise exception 'Elm Farm was not found.'; end if;
  v_org:=v_farm.organization_id;
  select * into v_anna from atlas.farm_memberships where farm_id=v_farm.id and worker_key='anna' and active order by created_at limit 1;
  select * into v_owner from atlas.farm_memberships where farm_id=v_farm.id and role='owner' and active order by created_at limit 1;
  if v_anna.id is null then raise exception 'Anna membership was not found.'; end if;

  for v_route in
    select * from (values
      ('mowing_field_rows_front_half','Field Rows · Front Half','field_rows','field_rows_front_half',4,1,'Riding mower',4.0,10,true),
      ('mowing_field_rows_back_half','Field Rows · Back Half','field_rows','field_rows_back_half',4,1,'Riding mower',4.0,20,true),
      ('mowing_follow_me_paths_edges','Follow Me Paths + Edges','follow_me','follow_me_paths_edges',7,1,'Push mower',4.0,30,true),
      ('mowing_curve_garden_edges','Curve Garden Edges','curve_garden','curve_garden_edges',7,1,'Push mower',4.0,40,true),
      ('mowing_u_pick_route','U-Pick Walkways + Middle Lane','u_pick','u_pick_paths',6,1,'Riding mower',3.5,50,true)
    ) as r(object_key,label,zone_key,legacy_member_key,cadence_days,warning_days,equipment_group,target_height,sort_order,guest_visible)
  loop
    insert into atlas.growing_objects(farm_id,zone_id,stable_key,label,object_type,object_mode,guest_visible,sort_order,metadata)
    select v_farm.id,z.id,v_route.object_key,v_route.label,'area','mowing_route',v_route.guest_visible,v_route.sort_order,
      jsonb_build_object(
        'domain','mowing','maintenance_collection','mowing','mowing_cadence_days',v_route.cadence_days,
        'mowing_warning_days',v_route.warning_days,'equipment_group',v_route.equipment_group,
        'target_cut_height_inches',v_route.target_height,'mowing_sort_order',v_route.sort_order,
        'legacy_collection_member_key',v_route.legacy_member_key,'zone_label',z.label,
        'physical_condition_authority','observation_only','source','elm_mowing_clock_pilot_v1'
      )
    from atlas.zones z where z.farm_id=v_farm.id and z.stable_key=v_route.zone_key
    on conflict(farm_id,stable_key) do update set
      zone_id=excluded.zone_id,label=excluded.label,object_type=excluded.object_type,object_mode=excluded.object_mode,
      guest_visible=excluded.guest_visible,sort_order=excluded.sort_order,
      metadata=atlas.growing_objects.metadata||excluded.metadata,updated_at=now()
    returning * into v_object;

    insert into atlas.rhythm_rules(
      organization_id,farm_id,rule_key,rhythm_key,version,label,status,applicability,
      validity_interval_seconds,warning_window_seconds,grace_window_seconds,
      qualifying_touches,failure_consequence,player_routing,activated_at,owner_reason,metadata
    ) values(
      v_org,v_farm.id,'elm_'||v_route.object_key,'mowing',1,'Mowing · '||v_route.label,'active',
      jsonb_build_object('subjectKind','growing_object','objectKey',v_route.object_key),
      v_route.cadence_days*86400,v_route.warning_days*86400,86400,
      jsonb_build_array(
        jsonb_build_object('effect','full','sourceKind','mowing_result','sourceEvent','mowed_full'),
        jsonb_build_object('effect','conditional','sourceKind','mowing_result','sourceEvent','acceptable_no_cut','renewalIntervalSeconds',172800),
        jsonb_build_object('effect','partial','sourceKind','mowing_result','sourceEvent','mowed_partial'),
        jsonb_build_object('effect','partial','sourceKind','mowing_result','sourceEvent','too_wet'),
        jsonb_build_object('effect','partial','sourceKind','mowing_result','sourceEvent','equipment_or_area_problem')
      ),
      jsonb_build_object(
        'dueTask',jsonb_build_object(
          'title','Mow — '||v_route.label,'priority','normal','taskType','mowing','actionKey','mow',
          'note','Observe the route first. Record a full mow, partial mow, acceptable no-cut condition, wet-ground delay, or a real problem.',
          'visibilityScope','assigned_worker','assignedMembershipId',v_anna.id
        ),
        'failureTask',jsonb_build_object(
          'title','Restore mowing rhythm — '||v_route.label,'priority','high','taskType','mowing','actionKey','mow',
          'note','The route passed its return interval without a qualifying mow or acceptable-no-cut observation. Observe and restore what is physically true.',
          'visibilityScope','assigned_worker','assignedMembershipId',v_anna.id
        ),
        'timeClaimsPhysicalCondition',false,'physicalConditionClaim','unknown_until_observed'
      ),
      jsonb_build_object(
        'visibilityScope','assigned_worker','assignedMembershipId',v_anna.id,'assignedUserId',v_anna.user_id,
        'dueRecipient','responsible_worker','failureEscalation','owner'
      ),
      now(),'Elm mowing cadence already recorded in the canonical mowing collection.',
      jsonb_build_object(
        'domain','mowing','boundaryMode','exact_timestamp','timezoneName','America/Chicago',
        'equipmentGroup',v_route.equipment_group,'targetCutHeightInches',v_route.target_height,
        'sourceCadenceDays',v_route.cadence_days,'timeClaimsPhysicalCondition',false,
        'physicalConditionAuthority','observation_only','pilot','elm_mowing_clock_pilot_v1'
      )
    )
    on conflict(farm_id,rule_key,version) do update set
      label=excluded.label,status='active',applicability=excluded.applicability,
      validity_interval_seconds=excluded.validity_interval_seconds,
      warning_window_seconds=excluded.warning_window_seconds,grace_window_seconds=excluded.grace_window_seconds,
      qualifying_touches=excluded.qualifying_touches,failure_consequence=excluded.failure_consequence,
      player_routing=excluded.player_routing,activated_at=coalesce(atlas.rhythm_rules.activated_at,excluded.activated_at),
      owner_reason=excluded.owner_reason,metadata=atlas.rhythm_rules.metadata||excluded.metadata,updated_at=now()
    returning * into v_rule;

    insert into atlas.rhythm_bindings(
      organization_id,farm_id,rhythm_rule_id,binding_key,inheritance_layer,subject_kind,subject_id,
      priority,active,active_from,created_by_user_id,owner_reason,metadata
    ) values(
      v_org,v_farm.id,v_rule.id,'elm:'||v_route.object_key,'subject_override','growing_object',v_object.id,
      100,true,now(),v_owner.user_id,'Enroll the real mowing route with its accepted cadence.',
      jsonb_build_object('routeObjectKey',v_route.object_key,'legacyCollectionMemberKey',v_route.legacy_member_key,'pilot','elm_mowing_clock_pilot_v1')
    )
    on conflict(farm_id,binding_key) do update set
      rhythm_rule_id=excluded.rhythm_rule_id,inheritance_layer=excluded.inheritance_layer,
      subject_kind=excluded.subject_kind,subject_id=excluded.subject_id,priority=excluded.priority,
      active=true,active_until=null,owner_reason=excluded.owner_reason,
      metadata=atlas.rhythm_bindings.metadata||excluded.metadata,updated_at=now()
    returning * into v_binding;

    insert into atlas.rhythm_state(
      organization_id,farm_id,rhythm_binding_id,rhythm_rule_id,rhythm_key,subject_kind,subject_id,
      state,effective_rule_version,visibility_scope,assigned_user_id,state_reason,metadata
    ) values(
      v_org,v_farm.id,v_binding.id,v_rule.id,'mowing','growing_object',v_object.id,
      'uninitialized',v_rule.version,'assigned_worker',v_anna.user_id,
      jsonb_build_object('source','elm_mowing_clock_pilot_v1','physicalCondition','unknown_until_observed'),
      jsonb_build_object('pilot','elm_mowing_clock_pilot_v1','legacyCollectionMemberKey',v_route.legacy_member_key)
    )
    on conflict(farm_id,rhythm_key,subject_kind,subject_id) do update set
      rhythm_binding_id=excluded.rhythm_binding_id,rhythm_rule_id=excluded.rhythm_rule_id,
      effective_rule_version=excluded.effective_rule_version,visibility_scope=excluded.visibility_scope,
      assigned_user_id=excluded.assigned_user_id,metadata=atlas.rhythm_state.metadata||excluded.metadata,updated_at=now();
  end loop;
end;
$$;
