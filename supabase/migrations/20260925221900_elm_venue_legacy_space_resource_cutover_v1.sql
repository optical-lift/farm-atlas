-- Recover Elm Farm's legacy Venue spatial model into the universal Reality resource kernel.
-- Production migration: 20260925221900_elm_venue_legacy_space_resource_cutover_v1
-- Stable keys are used to resolve canonical/legacy records; generated UUIDs are not embedded.

do $$
declare
  v_owner uuid;
  v_farm uuid;
  v_site uuid;
  v_event_center uuid;
  v_venue_zone uuid;
  v_rec record;
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

  select id into v_venue_zone
  from atlas.zones
  where farm_id=v_farm and stable_key='venue'
  limit 1;

  if v_owner is null or v_farm is null or v_site is null or v_venue_zone is null then
    raise exception 'Elm canonical entity, legacy farm, site resource, or Venue zone is missing.';
  end if;

  perform reality.upsert_resource_service_v1(
    v_owner,v_site,'event_center','Event Center','building',
    'active',true,'exclusive',null,null,'America/Chicago',
    jsonb_build_object(
      'firstAdopter','Elm Farm Venue Ledger',
      'resourceScope','indoor event center',
      'legacyVenueZoneId',v_venue_zone,
      'legacyVenueStableKey','venue',
      'farmAtlasSourceCommit','5f0d26a77327899de61ba32d2755bead42d88b7f',
      'farmAtlasSourcePath','supabase/migrations/20260722193000_add_venue_room_objects.sql',
      'cutover','elm_venue_legacy_space_resource_cutover_v1'
    )
  );

  select id into v_event_center
  from reality.resources
  where owner_entity_id=v_owner and stable_key='event_center'
  limit 1;

  for v_rec in
    select
      go.id as legacy_id,
      go.stable_key,
      go.label,
      go.object_mode as legacy_mode,
      go.sort_order,
      case when go.stable_key='venue_entry' then 'space' else 'room' end as resource_kind,
      case when go.stable_key='venue_entry' then false else true end as reservable,
      case when go.stable_key='venue_entry' then 'shared' else 'exclusive' end as capacity_mode
    from atlas.growing_objects go
    where go.farm_id=v_farm
      and go.stable_key in (
        'venue_entry','venue_lounge','venue_library','venue_kitchen',
        'venue_conference_room','venue_bathroom','venue_studio'
      )
  loop
    perform reality.upsert_resource_service_v1(
      v_owner,
      v_event_center,
      v_rec.stable_key,
      v_rec.label,
      v_rec.resource_kind,
      'active',
      v_rec.reservable,
      v_rec.capacity_mode,
      null,null,
      'America/Chicago',
      jsonb_build_object(
        'legacyAtlasTable','atlas.growing_objects',
        'legacyAtlasObjectId',v_rec.legacy_id,
        'legacyAtlasStableKey',v_rec.stable_key,
        'legacyAtlasObjectMode',v_rec.legacy_mode,
        'legacyAtlasVenueZoneId',v_venue_zone,
        'legacySortOrder',v_rec.sort_order,
        'guestFacing',true,
        'farmAtlasSourceCommit',case
          when v_rec.stable_key='venue_entry'
            then '4a6d9f8c27d7f7161af3a6c4ddbd6a0ded1ccde3'
          else '5f0d26a77327899de61ba32d2755bead42d88b7f'
        end,
        'farmAtlasSourcePath',case
          when v_rec.stable_key='venue_entry'
            then 'app/owner/task-card-lab/VenueCardSpecimen.tsx'
          else 'supabase/migrations/20260722193000_add_venue_room_objects.sql'
        end,
        'originalRoomModel',case
          when v_rec.legacy_mode='rental_room' then 'canonical_rentable_room'
          else 'venue_space_not_original_rentable_room'
        end,
        'cutover','elm_venue_legacy_space_resource_cutover_v1'
      )
    );
  end loop;
end $$;
