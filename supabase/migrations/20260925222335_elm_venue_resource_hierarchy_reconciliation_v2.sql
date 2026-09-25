-- Reconcile Elm Venue resource hierarchy against farm-atlas history and owner-confirmed physical identity.
-- Production migration: 20260925222335_elm_venue_resource_hierarchy_reconciliation_v2
-- Stable keys are used to resolve canonical/legacy records; generated UUIDs are not embedded.

do $$
declare
  v_owner uuid;
  v_farm uuid;
  v_site uuid;
  v_event_center uuid;
  v_kitchen uuid;
  v_dining uuid;
  v_legacy_id uuid;
  v_coffee_place_id uuid;
begin
  select id into v_owner
  from reality.entities
  where stable_key='elm-farm' and entity_kind='business'
  limit 1;

  select id into v_farm
  from atlas.farms
  where stable_key='elm_farm'
  limit 1;

  select id into v_site
  from reality.resources
  where owner_entity_id=v_owner and stable_key='elm_farm_site'
  limit 1;

  select id into v_event_center
  from reality.resources
  where owner_entity_id=v_owner and stable_key='event_center'
  limit 1;

  if v_owner is null or v_farm is null or v_site is null or v_event_center is null then
    raise exception 'Elm canonical resource tree is incomplete.';
  end if;

  -- Conference Room = Living Room = Meeting Room. Preserve one canonical physical resource.
  select id into v_legacy_id
  from atlas.growing_objects
  where farm_id=v_farm and stable_key='venue_conference_room'
  limit 1;

  perform reality.upsert_resource_service_v1(
    v_owner,v_event_center,'venue_conference_room','Conference Room','room',
    'active',true,'exclusive',null,null,'America/Chicago',
    jsonb_build_object(
      'legacyAtlasTable','atlas.growing_objects',
      'legacyAtlasObjectId',v_legacy_id,
      'legacyAtlasStableKey','venue_conference_room',
      'legacyAtlasObjectMode','rental_room',
      'physicalName','Living Room',
      'aliases',jsonb_build_array('Living Room','Meeting Room'),
      'openPlanGroup','farmhouse_main_open_plan',
      'openPlanConnectedTo',jsonb_build_array('venue_kitchen','venue_dining_room'),
      'identityClarifiedBy','owner_instruction_20260925',
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  select id into v_legacy_id
  from atlas.growing_objects
  where farm_id=v_farm and stable_key='venue_kitchen'
  limit 1;

  perform reality.upsert_resource_service_v1(
    v_owner,v_event_center,'venue_kitchen','Kitchen','room',
    'active',true,'exclusive',null,null,'America/Chicago',
    jsonb_build_object(
      'legacyAtlasTable','atlas.growing_objects',
      'legacyAtlasObjectId',v_legacy_id,
      'legacyAtlasStableKey','venue_kitchen',
      'legacyAtlasObjectMode','rental_room',
      'openPlanGroup','farmhouse_main_open_plan',
      'openPlanConnectedTo',jsonb_build_array('venue_dining_room','venue_conference_room'),
      'identityClarifiedBy','owner_instruction_20260925',
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  perform reality.upsert_resource_service_v1(
    v_owner,v_event_center,'venue_dining_room','Dining Room','room',
    'active',true,'exclusive',null,null,'America/Chicago',
    jsonb_build_object(
      'source','owner_instruction_20260925',
      'physicalTruth','distinct space in open floorplan between Kitchen and Living Room / Conference Room',
      'openPlanGroup','farmhouse_main_open_plan',
      'openPlanConnectedTo',jsonb_build_array('venue_kitchen','venue_conference_room'),
      'legacyAtlasRecord','none; recovered from later farm-atlas Venue station location text',
      'farmAtlasEvidence','Coffee bar and Water station location = Dining room',
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  select id into v_kitchen
  from reality.resources
  where owner_entity_id=v_owner and stable_key='venue_kitchen'
  limit 1;

  select id into v_dining
  from reality.resources
  where owner_entity_id=v_owner and stable_key='venue_dining_room'
  limit 1;

  select id into v_coffee_place_id
  from atlas.places
  where farm_id=v_farm and stable_key='coffee_bar'
  limit 1;

  perform reality.upsert_resource_service_v1(
    v_owner,v_kitchen,'coffee_bar','Coffee Bar','station',
    'active',false,'shared',null,null,'America/Chicago',
    jsonb_build_object(
      'legacyAtlasTable','atlas.places',
      'legacyAtlasPlaceId',v_coffee_place_id,
      'legacyAtlasPlaceType','work_station',
      'operationFamily','hospitality',
      'physicalLocation','Kitchen island',
      'adjacentTo','Dining Room',
      'farmAtlasHistoricalLocationText','Dining room',
      'locationClarifiedBy','owner_instruction_20260925',
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  perform reality.upsert_resource_service_v1(
    v_owner,v_dining,'venue_water_station','Water','station',
    'active',false,'shared',null,null,'America/Chicago',
    jsonb_build_object(
      'source','farm_atlas_venue_station_model',
      'physicalLocation','Dining Room',
      'historicalComponents',jsonb_build_array('Water dispenser','Clear cups'),
      'farmAtlasSourceCommit','086bfc5acda1782ac4e206697bdd09fdcc39d25a',
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  for v_legacy_id in
    select id
    from atlas.growing_objects
    where farm_id=v_farm
      and stable_key='venue_front_porch'
  loop
    perform reality.upsert_resource_service_v1(
      v_owner,v_event_center,'venue_front_porch','Front Porch','zone',
      'active',true,'shared',null,null,'America/Chicago',
      jsonb_build_object(
        'legacyAtlasTable','atlas.growing_objects',
        'legacyAtlasObjectId',v_legacy_id,
        'legacyAtlasObjectMode','venue_space',
        'objectSubtype','venue_exterior_space',
        'guestFacing',true,
        'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
      )
    );
  end loop;

  for v_legacy_id in
    select id
    from atlas.growing_objects
    where farm_id=v_farm
      and stable_key='venue_back_porch'
  loop
    perform reality.upsert_resource_service_v1(
      v_owner,v_event_center,'venue_back_porch','Back Porch','zone',
      'active',true,'shared',null,null,'America/Chicago',
      jsonb_build_object(
        'legacyAtlasTable','atlas.growing_objects',
        'legacyAtlasObjectId',v_legacy_id,
        'legacyAtlasObjectMode','maintenance',
        'objectSubtype','venue_exterior_space',
        'surfaceMaterial','cedar siding and porch surfaces',
        'guestFacing',true,
        'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
      )
    );
  end loop;

  for v_legacy_id in
    select id
    from atlas.growing_objects
    where farm_id=v_farm
      and stable_key='venue_concrete_entrance_porch'
  loop
    perform reality.upsert_resource_service_v1(
      v_owner,v_event_center,'venue_concrete_entrance_porch','Concrete Entrance Porch','zone',
      'active',true,'shared',null,null,'America/Chicago',
      jsonb_build_object(
        'legacyAtlasTable','atlas.growing_objects',
        'legacyAtlasObjectId',v_legacy_id,
        'legacyAtlasObjectMode','maintenance',
        'objectSubtype','venue_exterior_space',
        'surfaceMaterial','concrete',
        'guestFacing',true,
        'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
      )
    );
  end loop;

  select id into v_legacy_id
  from atlas.growing_objects
  where farm_id=v_farm and stable_key='detached_garage_trading_post'
  limit 1;

  perform reality.upsert_resource_service_v1(
    v_owner,v_site,'detached_garage_trading_post','Detached Garage / The Trading Post','building',
    'active',true,'exclusive',null,null,'America/Chicago',
    jsonb_build_object(
      'legacyAtlasTable','atlas.growing_objects',
      'legacyAtlasObjectId',v_legacy_id,
      'legacyAtlasObjectMode','venue_structure',
      'currentUse','detached_garage',
      'futureUse','trading_post',
      'guestFacing',true,
      'cutover','elm_venue_resource_hierarchy_reconciliation_v2'
    )
  );

  update atlas.growing_objects
  set guest_visible=false,
      metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'registry_hidden',true,
        'cutoverDisposition','excluded_by_owner',
        'excludedFromUniversalResourceKernel',true,
        'excludedAt',now(),
        'exclusionBasis','owner_instruction_20260925'
      ),
      updated_at=now()
  where farm_id=v_farm
    and stable_key in ('lounge_floor','venue_library_addition_exterior');

  update atlas.growing_objects
  set metadata=coalesce(metadata,'{}'::jsonb) || jsonb_build_object(
        'physical_name','Living Room',
        'aliases',jsonb_build_array('Living Room','Meeting Room'),
        'identity_clarified_at',now(),
        'identity_clarified_source','owner_instruction_20260925'
      ),
      updated_at=now()
  where farm_id=v_farm
    and stable_key='venue_conference_room';
end $$;
