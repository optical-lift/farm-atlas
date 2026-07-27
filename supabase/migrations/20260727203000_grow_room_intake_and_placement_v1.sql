-- Phase 2: one truthful Grow Room walkthrough can establish the physical room
-- and the living inventory. Unknown sowing facts remain null; routine watering
-- remains outside Atlas.

alter table atlas.production_tray_batches
  alter column source_task_id drop not null,
  alter column seeds_sown drop not null,
  alter column sown_date drop not null;

alter table atlas.production_tray_batches
  drop constraint if exists production_tray_batches_seeds_sown_check;
alter table atlas.production_tray_batches
  add constraint production_tray_batches_seeds_sown_check
  check (seeds_sown is null or seeds_sown > 0);

alter table atlas.production_tray_batches
  add column if not exists source_object_id uuid references atlas.growing_objects(id) on delete set null;
create index if not exists production_tray_batches_source_object_idx
  on atlas.production_tray_batches (source_object_id)
  where source_object_id is not null;

create or replace function atlas.grow_room_create_structure_v1(
  p_farm_id uuid,
  p_label text,
  p_structure_kind text,
  p_idempotency_key text,
  p_parent_object_id uuid default null,
  p_position_label text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_zone_id uuid;
  v_object_id uuid;
  v_stable_key text;
  v_slug text;
  v_object_type text;
  v_sort_order integer;
  v_parent_zone uuid;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;
  if nullif(btrim(p_label), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'A room label and idempotency key are required.' using errcode = '22023';
  end if;
  if p_structure_kind not in ('rack', 'shelf', 'hardening_area') then
    raise exception 'Structure kind must be rack, shelf, or hardening_area.' using errcode = '22023';
  end if;

  select id into v_zone_id
  from atlas.zones
  where farm_id = p_farm_id and stable_key = 'grow_room'
  limit 1;
  if v_zone_id is null then
    raise exception 'The Grow Room zone is missing.' using errcode = 'P0002';
  end if;

  if p_structure_kind = 'shelf' and p_parent_object_id is null then
    raise exception 'A shelf must belong to a rack or room section.' using errcode = '22023';
  end if;
  if p_parent_object_id is not null then
    select zone_id into v_parent_zone
    from atlas.growing_objects
    where id = p_parent_object_id and farm_id = p_farm_id;
    if v_parent_zone is distinct from v_zone_id then
      raise exception 'The parent position must be inside the Grow Room.' using errcode = '22023';
    end if;
  end if;

  v_slug := trim(both '_' from regexp_replace(lower(btrim(p_label)), '[^a-z0-9]+', '_', 'g'));
  if v_slug = '' then v_slug := p_structure_kind; end if;
  v_stable_key := 'grow_room_' || v_slug || '_' || substr(md5(p_idempotency_key), 1, 8);
  v_object_type := case when p_structure_kind = 'hardening_area' then 'area' else 'room' end;

  select coalesce(max(sort_order), 0) + 10 into v_sort_order
  from atlas.growing_objects
  where farm_id = p_farm_id and zone_id = v_zone_id;

  insert into atlas.growing_objects (
    farm_id, zone_id, stable_key, label, object_type, object_mode,
    guest_visible, sort_order, metadata
  ) values (
    p_farm_id, v_zone_id, v_stable_key, btrim(p_label), v_object_type, p_structure_kind,
    false, v_sort_order,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'grow_room_setup',
      'idempotency_key', p_idempotency_key,
      'structure_kind', p_structure_kind
    )
  )
  on conflict (farm_id, stable_key)
  do update set
    label = excluded.label,
    object_mode = excluded.object_mode,
    metadata = atlas.growing_objects.metadata || excluded.metadata,
    updated_at = now()
  returning id into v_object_id;

  if p_parent_object_id is not null then
    insert into atlas.growing_object_relationships (
      farm_id, parent_object_id, child_object_id, relationship_type,
      position_label, sort_order, metadata
    ) values (
      p_farm_id, p_parent_object_id, v_object_id, 'contains',
      nullif(btrim(p_position_label), ''), v_sort_order,
      jsonb_build_object('source', 'grow_room_setup')
    )
    on conflict (parent_object_id, child_object_id, relationship_type)
    do update set
      position_label = excluded.position_label,
      sort_order = excluded.sort_order,
      updated_at = now();
  end if;

  return jsonb_build_object(
    'ok', true,
    'objectId', v_object_id,
    'label', btrim(p_label),
    'structureKind', p_structure_kind,
    'parentObjectId', p_parent_object_id
  );
end;
$function$;

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
  v_profile record;
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
    return jsonb_build_object(
      'ok', true,
      'batchId', v_existing.id,
      'productionLotId', v_existing.production_lot_id,
      'deduplicated', true
    );
  end if;

  select id into v_zone_id
  from atlas.zones
  where farm_id = p_farm_id and stable_key = 'grow_room'
  limit 1;
  if v_zone_id is null then
    raise exception 'The Grow Room zone is missing.' using errcode = 'P0002';
  end if;

  if p_location_object_id is not null and not exists (
    select 1 from atlas.growing_objects
    where id = p_location_object_id and farm_id = p_farm_id and zone_id = v_zone_id
  ) then
    raise exception 'The selected shelf or room position is not inside the Grow Room.' using errcode = '22023';
  end if;
  if p_destination_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_destination_object_id and farm_id = p_farm_id
  ) then
    raise exception 'The selected destination is not part of this farm.' using errcode = '22023';
  end if;
  if p_source_object_id is not null and not exists (
    select 1 from atlas.growing_objects
    where id = p_source_object_id and farm_id = p_farm_id and zone_id = v_zone_id
  ) then
    raise exception 'The selected existing record is not part of the Grow Room.' using errcode = '22023';
  end if;

  if p_crop_profile_id is not null then
    select id, crop_label, variety, days_to_germination_min, days_to_germination_max
      into v_profile
    from atlas.crop_profiles
    where id = p_crop_profile_id;
    if v_profile.id is null then
      raise exception 'The selected crop profile was not found.' using errcode = '22023';
    end if;
  end if;

  v_crop_label := coalesce(nullif(btrim(v_profile.crop_label), ''), btrim(p_crop_label));
  v_variety := coalesce(nullif(btrim(v_profile.variety), ''), nullif(btrim(p_variety), ''));
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
    'active',
    jsonb_build_object('source', 'grow_room_intake', 'watering_logged', false)
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

  if p_sown_date is not null and v_profile.id is not null then
    if v_profile.days_to_germination_min is not null then
      v_expected_germination_start := p_sown_date + v_profile.days_to_germination_min;
    end if;
    if v_profile.days_to_germination_max is not null then
      v_expected_germination_end := p_sown_date + v_profile.days_to_germination_max;
    end if;
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
  )
  returning id into v_lot_id;

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
    case when v_status in ('germinated', 'seedling_care', 'pot_up_needed', 'hardening', 'transplant_ready') then coalesce(p_sown_date, current_date) else null end,
    p_live_quantity, p_live_quantity, 'seedlings',
    p_idempotency_key, v_action_required, v_action_key, nullif(btrim(p_note), ''),
    p_destination_object_id, v_now,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
      'source', 'grow_room_intake',
      'intake_verified_at', v_now,
      'watering_logged', false
    )
  ) returning id into v_batch_id;

  if p_location_object_id is not null then
    insert into atlas.production_tray_batch_locations (
      farm_id, tray_batch_id, location_object_id, placed_at, metadata
    ) values (
      p_farm_id, v_batch_id, p_location_object_id, v_now,
      jsonb_build_object('source', 'grow_room_intake')
    );
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
    jsonb_build_object(
      'status', v_status,
      'action_key', v_action_key,
      'destination_object_id', p_destination_object_id,
      'watering_logged', false
    )
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

create or replace function atlas.grow_room_assign_destination_v1(
  p_farm_id uuid,
  p_batch_id uuid,
  p_destination_object_id uuid,
  p_idempotency_key text,
  p_note text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_batch atlas.production_tray_batches%rowtype;
  v_existing atlas.production_lot_events%rowtype;
  v_event_id uuid;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;
  if p_batch_id is null or p_destination_object_id is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Batch, destination, and idempotency key are required.' using errcode = '22023';
  end if;

  select * into v_existing
  from atlas.production_lot_events
  where farm_id = p_farm_id and idempotency_key = p_idempotency_key;
  if v_existing.id is not null then
    return jsonb_build_object('ok', true, 'eventId', v_existing.id, 'batchId', p_batch_id, 'deduplicated', true);
  end if;

  select * into v_batch
  from atlas.production_tray_batches
  where id = p_batch_id and farm_id = p_farm_id
  for update;
  if v_batch.id is null then
    raise exception 'Grow Room batch was not found.' using errcode = 'P0002';
  end if;
  if not exists (
    select 1 from atlas.growing_objects where id = p_destination_object_id and farm_id = p_farm_id
  ) then
    raise exception 'The selected destination is not part of this farm.' using errcode = '22023';
  end if;

  update atlas.production_tray_batches
  set destination_object_id = p_destination_object_id,
      last_action_at = now(),
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('destination_assigned_at', now()),
      updated_at = now()
  where id = p_batch_id;

  insert into atlas.production_lot_events (
    farm_id, production_lot_id, event_type, event_date, quantity, unit,
    object_id, tray_batch_id, note, source, idempotency_key, metadata
  ) values (
    p_farm_id, v_batch.production_lot_id, 'destination_assigned', current_date,
    v_batch.current_quantity, v_batch.current_unit,
    p_destination_object_id, v_batch.id, nullif(btrim(p_note), ''),
    'grow_room_digital_room', p_idempotency_key,
    jsonb_build_object('watering_logged', false)
  ) returning id into v_event_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', v_event_id,
    'batchId', p_batch_id,
    'destinationObjectId', p_destination_object_id,
    'deduplicated', false
  );
end;
$function$;

create or replace function atlas.grow_room_state_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_zone_id uuid;
  v_zone jsonb := '{}'::jsonb;
  v_objects jsonb := '[]'::jsonb;
  v_relationships jsonb := '[]'::jsonb;
  v_batches jsonb := '[]'::jsonb;
  v_actions jsonb := '[]'::jsonb;
  v_visit_task jsonb := null;
  v_crop_profiles jsonb := '[]'::jsonb;
  v_destinations jsonb := '[]'::jsonb;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  select z.id,
         jsonb_build_object('zoneId', z.id, 'zoneKey', z.stable_key, 'label', z.label)
    into v_zone_id, v_zone
  from atlas.zones z
  where z.farm_id = p_farm_id and z.stable_key = 'grow_room'
  limit 1;

  if v_zone_id is null then
    return jsonb_build_object(
      'farmId', p_farm_id, 'zone', null, 'objects', '[]'::jsonb,
      'relationships', '[]'::jsonb, 'batches', '[]'::jsonb,
      'actions', '[]'::jsonb, 'visitTask', null,
      'cropProfiles', '[]'::jsonb, 'destinations', '[]'::jsonb
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'objectId', go.id,
    'objectKey', go.stable_key,
    'label', go.label,
    'objectType', go.object_type,
    'objectMode', go.object_mode,
    'sortOrder', go.sort_order,
    'metadata', coalesce(go.metadata, '{}'::jsonb)
  ) order by go.sort_order, go.label), '[]'::jsonb)
  into v_objects
  from atlas.growing_objects go
  where go.farm_id = p_farm_id and go.zone_id = v_zone_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'relationshipId', r.id,
    'parentObjectId', r.parent_object_id,
    'childObjectId', r.child_object_id,
    'relationshipType', r.relationship_type,
    'positionLabel', r.position_label,
    'sortOrder', r.sort_order,
    'metadata', r.metadata
  ) order by r.sort_order, r.created_at), '[]'::jsonb)
  into v_relationships
  from atlas.growing_object_relationships r
  join atlas.growing_objects parent on parent.id = r.parent_object_id
  join atlas.growing_objects child on child.id = r.child_object_id
  where r.farm_id = p_farm_id
    and (parent.zone_id = v_zone_id or child.zone_id = v_zone_id);

  select coalesce(jsonb_agg(jsonb_build_object(
    'batchId', b.id,
    'productionLotId', b.production_lot_id,
    'batchNumber', b.batch_number,
    'batchLabel', b.batch_label,
    'containerKind', b.container_kind,
    'blockSizeIn', b.block_size_in,
    'trayCount', b.tray_count,
    'seedsSown', b.seeds_sown,
    'seedUnit', b.seed_unit,
    'status', b.status,
    'sownDate', b.sown_date,
    'expectedGerminationStart', b.expected_germination_start,
    'expectedGerminationEnd', b.expected_germination_end,
    'germinatedDate', b.germinated_date,
    'viableSeedlings', b.viable_seedlings,
    'currentQuantity', b.current_quantity,
    'currentUnit', b.current_unit,
    'actionRequired', b.action_required,
    'actionKey', b.action_key,
    'actionDueDate', b.action_due_date,
    'actionNote', b.action_note,
    'lastObservedAt', b.last_observed_at,
    'lastActionAt', b.last_action_at,
    'destinationObjectId', b.destination_object_id,
    'destinationLabel', destination.label,
    'sourceObjectId', b.source_object_id,
    'cropProfileId', lot.crop_profile_id,
    'cropLabel', coalesce(cp.crop_label, lot.metadata ->> 'crop_label_entered', lot.lot_label),
    'variety', coalesce(cp.variety, lot.metadata ->> 'variety_entered'),
    'lotLabel', lot.lot_label,
    'lotStage', lot.current_stage,
    'lotLifecycleStatus', lot.lifecycle_status,
    'expectedTransplantStart', lot.expected_transplant_start,
    'expectedTransplantEnd', lot.expected_transplant_end,
    'expectedHarvestStart', lot.expected_harvest_start,
    'expectedHarvestEnd', lot.expected_harvest_end,
    'locationObjectId', loc.location_object_id,
    'locationLabel', location.label,
    'positionLabel', loc.position_label,
    'metadata', coalesce(b.metadata, '{}'::jsonb)
  ) order by coalesce(location.sort_order, 999999), location.label nulls last, b.batch_label), '[]'::jsonb)
  into v_batches
  from atlas.production_tray_batches b
  join atlas.production_lots lot on lot.id = b.production_lot_id
  left join atlas.crop_profiles cp on cp.id = lot.crop_profile_id
  left join atlas.production_tray_batch_locations loc on loc.tray_batch_id = b.id and loc.removed_at is null
  left join atlas.growing_objects location on location.id = loc.location_object_id
  left join atlas.growing_objects destination on destination.id = b.destination_object_id
  where b.farm_id = p_farm_id and b.status not in ('closed', 'transplanted');

  select coalesce(jsonb_agg(jsonb_build_object(
    'taskId', t.id,
    'title', t.title,
    'taskType', t.task_type,
    'actionKey', t.action_key,
    'status', t.status,
    'priority', t.priority,
    'dueDate', t.due_date,
    'zoneLabel', z.label,
    'batchId', linked_batch.id,
    'batchLabel', linked_batch.batch_label,
    'metadata', coalesce(t.metadata, '{}'::jsonb)
  ) order by t.due_date nulls last, t.priority desc, t.created_at), '[]'::jsonb)
  into v_actions
  from atlas.tasks t
  left join atlas.zones z on z.id = t.zone_id
  left join lateral (
    select b1.id, b1.batch_label
    from atlas.production_tray_batches b1
    left join atlas.production_lot_tasks plt on plt.production_lot_id = b1.production_lot_id and plt.task_id = t.id
    where b1.farm_id = p_farm_id and (b1.source_task_id = t.id or plt.task_id is not null)
    order by b1.batch_number
    limit 1
  ) linked_batch on true
  where t.farm_id = p_farm_id
    and t.status in ('open', 'blocked')
    and not (t.task_type = 'grow_room_care' and lower(t.title) in ('grow room care', 'water + check grow room', 'check grow room'))
    and lower(coalesce(t.action_key, '')) not in ('water', 'watering')
    and (
      t.zone_id = v_zone_id
      or linked_batch.id is not null
      or coalesce(t.metadata ->> 'collection_zone', '') ilike '%grow room%'
      or coalesce(t.metadata ->> 'location_label', '') ilike '%grow room%'
      or coalesce(t.metadata ->> 'work_route', '') in ('grow_room_check', 'grow_room_audit', 'pot_up', 'hardening_off', 'soil_block')
    );

  select jsonb_build_object('taskId', t.id, 'title', t.title, 'dueDate', t.due_date, 'status', t.status)
  into v_visit_task
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.status in ('open', 'blocked')
    and t.task_type = 'grow_room_care'
    and lower(t.title) in ('grow room care', 'water + check grow room', 'check grow room')
  order by case when t.due_date = current_date then 0 else 1 end, t.due_date nulls last, t.created_at desc
  limit 1;

  select coalesce(jsonb_agg(jsonb_build_object(
    'cropProfileId', cp.id,
    'stableKey', cp.stable_key,
    'cropLabel', cp.crop_label,
    'variety', cp.variety,
    'daysToGerminationMin', cp.days_to_germination_min,
    'daysToGerminationMax', cp.days_to_germination_max
  ) order by cp.crop_label, cp.variety nulls first), '[]'::jsonb)
  into v_crop_profiles
  from atlas.crop_profiles cp;

  select coalesce(jsonb_agg(jsonb_build_object(
    'objectId', go.id,
    'objectKey', go.stable_key,
    'label', go.label,
    'objectType', go.object_type,
    'objectMode', go.object_mode,
    'zoneId', z.id,
    'zoneKey', z.stable_key,
    'zoneLabel', z.label,
    'sortOrder', go.sort_order
  ) order by z.sort_order, z.label, go.sort_order, go.label), '[]'::jsonb)
  into v_destinations
  from atlas.growing_objects go
  left join atlas.zones z on z.id = go.zone_id
  where go.farm_id = p_farm_id
    and go.zone_id is distinct from v_zone_id
    and go.object_type in ('bed', 'arch_bed', 'area', 'room');

  return jsonb_build_object(
    'farmId', p_farm_id,
    'zone', v_zone,
    'objects', v_objects,
    'relationships', v_relationships,
    'batches', v_batches,
    'actions', v_actions,
    'visitTask', v_visit_task,
    'cropProfiles', v_crop_profiles,
    'destinations', v_destinations,
    'rules', jsonb_build_object(
      'wateringLogged', false,
      'ordinaryCareIsHabit', true,
      'onlyActionBearingChangesAreRecorded', true,
      'unknownSowingFactsStayUnknown', true
    )
  );
end;
$function$;

revoke all on function atlas.grow_room_create_structure_v1(uuid, text, text, text, uuid, text, jsonb) from public;
grant execute on function atlas.grow_room_create_structure_v1(uuid, text, text, text, uuid, text, jsonb) to authenticated;
revoke all on function atlas.grow_room_intake_batch_v1(uuid, text, text, text, text, numeric, text, uuid, text, numeric, date, numeric, uuid, uuid, uuid, text, text, jsonb) from public;
grant execute on function atlas.grow_room_intake_batch_v1(uuid, text, text, text, text, numeric, text, uuid, text, numeric, date, numeric, uuid, uuid, uuid, text, text, jsonb) to authenticated;
revoke all on function atlas.grow_room_assign_destination_v1(uuid, uuid, uuid, text, text) from public;
grant execute on function atlas.grow_room_assign_destination_v1(uuid, uuid, uuid, text, text) to authenticated;

comment on function atlas.grow_room_create_structure_v1(uuid, text, text, text, uuid, text, jsonb) is
  'Creates a truthful Grow Room rack, shelf, or hardening area without inventing physical structure.';
comment on function atlas.grow_room_intake_batch_v1(uuid, text, text, text, text, numeric, text, uuid, text, numeric, date, numeric, uuid, uuid, uuid, text, text, jsonb) is
  'Creates one physically verified Grow Room batch. Unknown sowing date and seed count remain null.';
comment on function atlas.grow_room_assign_destination_v1(uuid, uuid, uuid, text, text) is
  'Links a living Grow Room batch to its intended farm destination and records evidence.';
