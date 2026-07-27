-- Preserve unknown profile and germination facts during intake.
create or replace function atlas.grow_room_intake_batch_v1(
  p_farm_id uuid,
  p_idempotency_key text,
  p_crop_label text,
  p_batch_label text,
  p_container_kind text,
  p_tray_count numeric,
  p_status text,
  p_crop_profile_id uuid default null,
  p_variety text default null,
  p_live_quantity numeric default null,
  p_sown_date date default null,
  p_seeds_sown numeric default null,
  p_location_object_id uuid default null,
  p_destination_object_id uuid default null,
  p_source_object_id uuid default null,
  p_action_key text default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_existing atlas.production_tray_batches%rowtype;
  v_zone_id uuid;
  v_program_id uuid;
  v_lot_id uuid;
  v_batch_id uuid;
  v_event_id uuid;
  v_profile_crop_label text;
  v_profile_variety text;
  v_germination_min integer;
  v_germination_max integer;
  v_crop_label text;
  v_variety text;
  v_program_key text;
  v_lot_key text;
  v_status text;
  v_action_key text;
  v_action_required boolean;
  v_expected_germination_start date;
  v_expected_germination_end date;
  v_now timestamptz := now();
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;
  if nullif(btrim(p_idempotency_key), '') is null
     or nullif(btrim(p_crop_label), '') is null
     or nullif(btrim(p_batch_label), '') is null
     or nullif(btrim(p_container_kind), '') is null then
    raise exception 'Crop, batch label, container, and idempotency key are required.' using errcode = '22023';
  end if;
  if p_tray_count is null or p_tray_count <= 0 then
    raise exception 'Tray or container count must be greater than zero.' using errcode = '22023';
  end if;
  if p_live_quantity is not null and p_live_quantity < 0 then
    raise exception 'Live quantity cannot be negative.' using errcode = '22023';
  end if;
  if p_seeds_sown is not null and p_seeds_sown <= 0 then
    raise exception 'Seeds sown must be positive when known.' using errcode = '22023';
  end if;
  if p_status not in ('germination_pending', 'germinated', 'seedling_care', 'pot_up_needed', 'hardening', 'transplant_ready', 'failed') then
    raise exception 'Unsupported Grow Room intake stage.' using errcode = '22023';
  end if;
  if p_action_key is not null and p_action_key not in ('thin_or_separate', 'begin_hardening', 'pot_up', 'transplant', 'replacement_decision') then
    raise exception 'Unsupported Grow Room intake action.' using errcode = '22023';
  end if;

  select * into v_existing
  from atlas.production_tray_batches
  where farm_id = p_farm_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'batchId', v_existing.id, 'productionLotId', v_existing.production_lot_id, 'deduplicated', true);
  end if;

  select id into v_zone_id
  from atlas.zones
  where farm_id = p_farm_id and stable_key = 'grow_room'
  limit 1;
  if v_zone_id is null then
    raise exception 'The Grow Room zone is missing.' using errcode = 'P0002';
  end if;

  if p_location_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_location_object_id and farm_id = p_farm_id and zone_id = v_zone_id
  ) then
    raise exception 'The selected shelf or room position is not inside the Grow Room.' using errcode = '22023';
  end if;
  if p_destination_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_destination_object_id and farm_id = p_farm_id
  ) then
    raise exception 'The selected destination is not part of this farm.' using errcode = '22023';
  end if;
  if p_source_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_source_object_id and farm_id = p_farm_id and zone_id = v_zone_id
  ) then
    raise exception 'The selected existing record is not part of the Grow Room.' using errcode = '22023';
  end if;

  if p_crop_profile_id is not null then
    select crop_label, variety, days_to_germination_min, days_to_germination_max
      into v_profile_crop_label, v_profile_variety, v_germination_min, v_germination_max
    from atlas.crop_profiles
    where id = p_crop_profile_id;
    if not found then
      raise exception 'The selected crop profile was not found.' using errcode = '22023';
    end if;
  end if;

  v_crop_label := coalesce(nullif(btrim(v_profile_crop_label), ''), btrim(p_crop_label));
  v_variety := coalesce(nullif(btrim(v_profile_variety), ''), nullif(btrim(p_variety), ''));
  v_program_key := 'grow_room_verified_inventory_' || extract(year from current_date)::integer::text;

  insert into atlas.production_programs (
    farm_id, stable_key, season_year, program_label, program_kind,
    promise_text, intended_uses, status, metadata
  ) values (
    p_farm_id, v_program_key, extract(year from current_date)::integer,
    'Grow Room Verified Inventory ' || extract(year from current_date)::integer::text,
    'grow_room_inventory',
    'Track only plants physically verified alive in the Grow Room.',
    array['transplant', 'field_planning', 'stem_estimation']::text[],
    'active', jsonb_build_object('source', 'grow_room_intake', 'watering_logged', false)
  )
  on conflict (farm_id, stable_key)
  do update set status = 'active', updated_at = now()
  returning id into v_program_id;

  v_lot_key := 'grow_room_intake_' || substr(md5(p_idempotency_key), 1, 20);
  v_status := p_status;
  v_action_key := p_action_key;
  if v_action_key is null then
    v_action_key := case
      when v_status = 'pot_up_needed' then 'pot_up'
      when v_status = 'transplant_ready' then 'transplant'
      when v_status = 'failed' then 'replacement_decision'
      else null
    end;
  end if;
  v_action_required := v_action_key is not null;

  if p_sown_date is not null and v_germination_min is not null then
    v_expected_germination_start := p_sown_date + v_germination_min;
  end if;
  if p_sown_date is not null and v_germination_max is not null then
    v_expected_germination_end := p_sown_date + v_germination_max;
  end if;

  insert into atlas.production_lots (
    farm_id, program_id, crop_profile_id, stable_key, lot_label,
    planned_input_quantity, planned_input_unit, current_quantity, current_unit,
    current_stage, lifecycle_status, actual_sow_date, metadata
  ) values (
    p_farm_id, v_program_id, p_crop_profile_id, v_lot_key,
    v_crop_label || coalesce(' · ' || v_variety, '') || ' · ' || btrim(p_batch_label),
    p_seeds_sown, 'seeds', p_live_quantity, 'seedlings',
    v_status, case when v_status = 'failed' then 'failed' else 'active' end,
    p_sown_date,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'grow_room_intake',
      'verified_alive', v_status <> 'failed',
      'crop_label_entered', btrim(p_crop_label),
      'variety_entered', nullif(btrim(p_variety), ''),
      'unknown_sowing_facts_preserved', p_sown_date is null or p_seeds_sown is null
    )
  ) returning id into v_lot_id;

  insert into atlas.production_tray_batches (
    farm_id, production_lot_id, source_task_id, source_object_id, batch_number,
    batch_label, container_kind, seeds_sown, seed_unit, tray_count, status,
    sown_date, expected_germination_start, expected_germination_end,
    germinated_date, viable_seedlings, current_quantity, current_unit,
    idempotency_key, action_required, action_key, action_note,
    destination_object_id, last_observed_at, metadata
  ) values (
    p_farm_id, v_lot_id, null, p_source_object_id, 1,
    btrim(p_batch_label), btrim(p_container_kind), p_seeds_sown, 'seeds', p_tray_count, v_status,
    p_sown_date, v_expected_germination_start, v_expected_germination_end,
    null, p_live_quantity, p_live_quantity, 'seedlings',
    p_idempotency_key, v_action_required, v_action_key, nullif(btrim(p_note), ''),
    p_destination_object_id, v_now,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('source', 'grow_room_intake', 'intake_verified_at', v_now, 'watering_logged', false)
  ) returning id into v_batch_id;

  if p_location_object_id is not null then
    insert into atlas.production_tray_batch_locations (farm_id, tray_batch_id, location_object_id, placed_at, metadata)
    values (p_farm_id, v_batch_id, p_location_object_id, v_now, jsonb_build_object('source', 'grow_room_intake'));
  end if;

  if p_source_object_id is not null then
    update atlas.growing_objects
    set metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object(
      'canonical_tray_batch_id', v_batch_id,
      'canonical_production_lot_id', v_lot_id,
      'reconciled_at', v_now
    ), updated_at = v_now
    where id = p_source_object_id;
  end if;

  insert into atlas.production_lot_events (
    farm_id, production_lot_id, event_type, event_date, quantity, unit,
    object_id, tray_batch_id, note, source, idempotency_key, metadata
  ) values (
    p_farm_id, v_lot_id, 'inventory_verified', current_date, p_live_quantity, 'seedlings',
    coalesce(p_location_object_id, p_source_object_id), v_batch_id,
    nullif(btrim(p_note), ''), 'grow_room_intake', p_idempotency_key || ':event',
    jsonb_build_object('status', v_status, 'action_key', v_action_key, 'destination_object_id', p_destination_object_id, 'watering_logged', false)
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'batchId', v_batch_id,
    'productionLotId', v_lot_id,
    'eventId', v_event_id,
    'status', v_status,
    'actionRequired', v_action_required,
    'actionKey', v_action_key,
    'deduplicated', false
  );
end;
$function$;
