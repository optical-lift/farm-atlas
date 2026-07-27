-- Trail foundation: the Grow Room is a physical room containing shelves and living batches.
-- Routine watering is intentionally absent. Entering the room implies ordinary care;
-- Atlas records only biological facts, exceptions, moves, and action-bearing state changes.

create table if not exists atlas.growing_object_relationships (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  parent_object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  child_object_id uuid not null references atlas.growing_objects(id) on delete cascade,
  relationship_type text not null default 'contains' check (relationship_type in ('contains', 'adjacent', 'destination')),
  position_label text,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (parent_object_id, child_object_id, relationship_type),
  check (parent_object_id <> child_object_id)
);

create index if not exists growing_object_relationships_farm_parent_idx
  on atlas.growing_object_relationships (farm_id, parent_object_id, sort_order);
create index if not exists growing_object_relationships_farm_child_idx
  on atlas.growing_object_relationships (farm_id, child_object_id);

create table if not exists atlas.production_tray_batch_locations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete cascade,
  location_object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  position_label text,
  placed_at timestamptz not null default now(),
  removed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (removed_at is null or removed_at >= placed_at)
);

create unique index if not exists production_tray_batch_locations_one_active_idx
  on atlas.production_tray_batch_locations (tray_batch_id)
  where removed_at is null;
create index if not exists production_tray_batch_locations_location_idx
  on atlas.production_tray_batch_locations (farm_id, location_object_id)
  where removed_at is null;

alter table atlas.production_lot_events
  add column if not exists tray_batch_id uuid references atlas.production_tray_batches(id) on delete set null;
create index if not exists production_lot_events_tray_batch_idx
  on atlas.production_lot_events (tray_batch_id, event_date, created_at);

alter table atlas.production_tray_batches
  add column if not exists action_required boolean not null default false,
  add column if not exists action_key text,
  add column if not exists action_due_date date,
  add column if not exists action_note text,
  add column if not exists destination_object_id uuid references atlas.growing_objects(id) on delete set null,
  add column if not exists last_observed_at timestamptz,
  add column if not exists last_action_at timestamptz;

alter table atlas.production_tray_batches
  drop constraint if exists production_tray_batches_status_check;
alter table atlas.production_tray_batches
  add constraint production_tray_batches_status_check check (status = any (array[
    'germination_pending'::text,
    'germinated'::text,
    'seedling_care'::text,
    'pot_up_needed'::text,
    'hardening'::text,
    'transplant_ready'::text,
    'failed'::text,
    'transplanted'::text,
    'closed'::text
  ]));

create or replace function atlas.validate_growing_object_relationship_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $function$
declare
  v_parent_farm uuid;
  v_child_farm uuid;
begin
  select farm_id into v_parent_farm from atlas.growing_objects where id = new.parent_object_id;
  select farm_id into v_child_farm from atlas.growing_objects where id = new.child_object_id;
  if v_parent_farm is null or v_child_farm is null or v_parent_farm <> new.farm_id or v_child_farm <> new.farm_id then
    raise exception 'Grow Room object relationships must stay inside one farm.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists validate_growing_object_relationship_v1 on atlas.growing_object_relationships;
create trigger validate_growing_object_relationship_v1
before insert or update on atlas.growing_object_relationships
for each row execute function atlas.validate_growing_object_relationship_v1();

create or replace function atlas.validate_production_tray_batch_location_v1()
returns trigger
language plpgsql
set search_path = pg_catalog, atlas
as $function$
declare
  v_batch_farm uuid;
  v_location_farm uuid;
begin
  select farm_id into v_batch_farm from atlas.production_tray_batches where id = new.tray_batch_id;
  select farm_id into v_location_farm from atlas.growing_objects where id = new.location_object_id;
  if v_batch_farm is null or v_location_farm is null or v_batch_farm <> new.farm_id or v_location_farm <> new.farm_id then
    raise exception 'Tray placement must stay inside the batch farm.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

drop trigger if exists validate_production_tray_batch_location_v1 on atlas.production_tray_batch_locations;
create trigger validate_production_tray_batch_location_v1
before insert or update on atlas.production_tray_batch_locations
for each row execute function atlas.validate_production_tray_batch_location_v1();

alter table atlas.growing_object_relationships enable row level security;
alter table atlas.production_tray_batch_locations enable row level security;

create policy growing_object_relationships_member_read
on atlas.growing_object_relationships for select
to authenticated
using (atlas.is_farm_member(farm_id));

create policy production_tray_batch_locations_member_read
on atlas.production_tray_batch_locations for select
to authenticated
using (atlas.is_farm_member(farm_id));

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
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;

  select z.id,
         jsonb_build_object('zoneId', z.id, 'zoneKey', z.stable_key, 'label', z.label)
    into v_zone_id, v_zone
  from atlas.zones z
  where z.farm_id = p_farm_id
    and z.stable_key = 'grow_room'
  limit 1;

  if v_zone_id is null then
    return jsonb_build_object(
      'farmId', p_farm_id,
      'zone', null,
      'objects', '[]'::jsonb,
      'relationships', '[]'::jsonb,
      'batches', '[]'::jsonb,
      'actions', '[]'::jsonb,
      'visitTask', null
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
  where go.farm_id = p_farm_id
    and go.zone_id = v_zone_id;

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
    'cropLabel', coalesce(cp.crop_label, lot.lot_label),
    'variety', cp.variety,
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
  where b.farm_id = p_farm_id
    and b.status not in ('closed', 'transplanted');

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
    where b1.farm_id = p_farm_id
      and (b1.source_task_id = t.id or plt.task_id is not null)
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

  select jsonb_build_object(
    'taskId', t.id,
    'title', t.title,
    'dueDate', t.due_date,
    'status', t.status
  )
  into v_visit_task
  from atlas.tasks t
  where t.farm_id = p_farm_id
    and t.status in ('open', 'blocked')
    and t.task_type = 'grow_room_care'
    and lower(t.title) in ('grow room care', 'water + check grow room', 'check grow room')
  order by case when t.due_date = current_date then 0 else 1 end, t.due_date nulls last, t.created_at desc
  limit 1;

  return jsonb_build_object(
    'farmId', p_farm_id,
    'zone', v_zone,
    'objects', v_objects,
    'relationships', v_relationships,
    'batches', v_batches,
    'actions', v_actions,
    'visitTask', v_visit_task,
    'rules', jsonb_build_object(
      'wateringLogged', false,
      'ordinaryCareIsHabit', true,
      'onlyActionBearingChangesAreRecorded', true
    )
  );
end;
$function$;

create or replace function atlas.grow_room_record_batch_action_v1(
  p_farm_id uuid,
  p_batch_id uuid,
  p_action_key text,
  p_idempotency_key text,
  p_quantity numeric default null,
  p_unit text default null,
  p_action_date date default current_date,
  p_location_object_id uuid default null,
  p_destination_object_id uuid default null,
  p_note text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $function$
declare
  v_batch atlas.production_tray_batches%rowtype;
  v_lot atlas.production_lots%rowtype;
  v_existing atlas.production_lot_events%rowtype;
  v_event_id uuid;
  v_status text;
  v_action_required boolean;
  v_next_action text;
  v_now timestamptz := now();
  v_distinct_statuses integer;
  v_lot_quantity numeric;
begin
  if p_farm_id is null or not atlas.is_farm_member(p_farm_id) then
    raise exception 'Farm access is not active.' using errcode = '42501';
  end if;
  if p_batch_id is null or nullif(btrim(p_action_key), '') is null or nullif(btrim(p_idempotency_key), '') is null then
    raise exception 'Batch, action, and idempotency key are required.' using errcode = '22023';
  end if;
  if lower(p_action_key) in ('water', 'watered', 'watering', 'moisture_check') then
    raise exception 'Routine Grow Room watering is a habit and is not recorded as a Trail action.' using errcode = '22023';
  end if;
  if p_action_key not in (
    'stand_counted', 'germination_failed', 'replacement_requested',
    'mark_pot_up_needed', 'pot_up_completed', 'hardening_started',
    'hardening_advanced', 'ready_to_transplant', 'moved',
    'transplanted', 'count_adjusted', 'closed'
  ) then
    raise exception 'Unsupported Grow Room batch action.' using errcode = '22023';
  end if;
  if p_quantity is not null and p_quantity < 0 then
    raise exception 'Quantity cannot be negative.' using errcode = '22023';
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
  select * into v_lot from atlas.production_lots where id = v_batch.production_lot_id for update;

  if p_location_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_location_object_id and farm_id = p_farm_id
  ) then
    raise exception 'The selected batch location is not part of this farm.' using errcode = '22023';
  end if;
  if p_destination_object_id is not null and not exists (
    select 1 from atlas.growing_objects where id = p_destination_object_id and farm_id = p_farm_id
  ) then
    raise exception 'The selected transplant destination is not part of this farm.' using errcode = '22023';
  end if;

  v_status := v_batch.status;
  v_action_required := false;
  v_next_action := null;

  case p_action_key
    when 'stand_counted' then
      v_status := case when coalesce(p_quantity, 0) = 0 then 'failed' else 'germinated' end;
    when 'germination_failed' then
      v_status := 'failed';
      p_quantity := 0;
      v_action_required := true;
      v_next_action := 'replacement_decision';
    when 'replacement_requested' then
      v_status := 'failed';
      v_action_required := true;
      v_next_action := 're_sow';
    when 'mark_pot_up_needed' then
      v_status := 'pot_up_needed';
      v_action_required := true;
      v_next_action := 'pot_up';
    when 'pot_up_completed' then
      v_status := 'seedling_care';
    when 'hardening_started' then
      v_status := 'hardening';
    when 'hardening_advanced' then
      v_status := 'hardening';
    when 'ready_to_transplant' then
      v_status := 'transplant_ready';
      v_action_required := true;
      v_next_action := 'transplant';
    when 'transplanted' then
      v_status := 'transplanted';
    when 'closed' then
      v_status := 'closed';
    else
      v_status := v_batch.status;
  end case;

  if p_location_object_id is not null then
    update atlas.production_tray_batch_locations
    set removed_at = v_now, updated_at = v_now
    where tray_batch_id = v_batch.id and removed_at is null and location_object_id <> p_location_object_id;

    insert into atlas.production_tray_batch_locations (
      farm_id, tray_batch_id, location_object_id, placed_at, metadata
    ) values (
      p_farm_id, v_batch.id, p_location_object_id, v_now,
      jsonb_build_object('source', 'grow_room_batch_action', 'action_key', p_action_key)
    )
    on conflict (tray_batch_id) where removed_at is null
    do update set location_object_id = excluded.location_object_id, placed_at = excluded.placed_at,
      removed_at = null, metadata = atlas.production_tray_batch_locations.metadata || excluded.metadata,
      updated_at = v_now;
  end if;

  update atlas.production_tray_batches
  set status = v_status,
      germinated_date = case
        when p_action_key = 'stand_counted' and coalesce(p_quantity, 0) > 0 then coalesce(germinated_date, p_action_date)
        else germinated_date
      end,
      viable_seedlings = case
        when p_action_key in ('stand_counted', 'germination_failed', 'count_adjusted') then p_quantity
        else viable_seedlings
      end,
      current_quantity = case
        when p_quantity is not null and p_action_key in ('stand_counted', 'germination_failed', 'pot_up_completed', 'transplanted', 'count_adjusted') then p_quantity
        else current_quantity
      end,
      current_unit = case when p_quantity is not null then coalesce(nullif(btrim(p_unit), ''), current_unit, 'seedlings') else current_unit end,
      action_required = v_action_required,
      action_key = v_next_action,
      action_due_date = case when v_action_required then action_due_date else null end,
      action_note = case when v_action_required then coalesce(nullif(btrim(p_note), ''), action_note) else null end,
      destination_object_id = coalesce(p_destination_object_id, destination_object_id),
      last_observed_at = case when p_action_key in ('stand_counted', 'germination_failed', 'count_adjusted') then v_now else last_observed_at end,
      last_action_at = v_now,
      metadata = coalesce(metadata, '{}'::jsonb) || coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('last_grow_room_action', p_action_key),
      updated_at = v_now
  where id = v_batch.id;

  insert into atlas.production_lot_events (
    farm_id, production_lot_id, event_type, event_date, quantity, unit,
    crop_cycle_id, object_id, tray_batch_id, note, source, idempotency_key, metadata
  ) values (
    p_farm_id, v_batch.production_lot_id, p_action_key, coalesce(p_action_date, current_date), p_quantity,
    coalesce(nullif(btrim(p_unit), ''), v_batch.current_unit), v_batch.crop_cycle_id,
    coalesce(p_destination_object_id, p_location_object_id), v_batch.id, nullif(btrim(p_note), ''),
    'grow_room_room_round', p_idempotency_key,
    coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object('watering_logged', false)
  ) returning id into v_event_id;

  select count(distinct status),
         coalesce(sum(coalesce(current_quantity, viable_seedlings, 0)) filter (where status not in ('failed', 'closed')), 0)
    into v_distinct_statuses, v_lot_quantity
  from atlas.production_tray_batches
  where production_lot_id = v_batch.production_lot_id;

  update atlas.production_lots
  set current_quantity = v_lot_quantity,
      current_unit = coalesce(current_unit, 'seedlings'),
      current_stage = case
        when v_distinct_statuses = 1 then v_status
        else 'mixed_batch_state'
      end,
      lifecycle_status = case
        when not exists (select 1 from atlas.production_tray_batches x where x.production_lot_id = v_batch.production_lot_id and x.status not in ('failed', 'closed', 'transplanted'))
             and exists (select 1 from atlas.production_tray_batches x where x.production_lot_id = v_batch.production_lot_id and x.status = 'transplanted') then 'completed'
        when not exists (select 1 from atlas.production_tray_batches x where x.production_lot_id = v_batch.production_lot_id and x.status not in ('failed', 'closed'))
             and not exists (select 1 from atlas.production_tray_batches x where x.production_lot_id = v_batch.production_lot_id and x.status = 'transplanted') then 'failed'
        else lifecycle_status
      end,
      metadata = coalesce(metadata, '{}'::jsonb) || jsonb_build_object('last_grow_room_event_id', v_event_id, 'last_grow_room_action', p_action_key),
      updated_at = v_now
  where id = v_batch.production_lot_id;

  return jsonb_build_object(
    'ok', true,
    'eventId', v_event_id,
    'batchId', v_batch.id,
    'productionLotId', v_batch.production_lot_id,
    'status', v_status,
    'actionRequired', v_action_required,
    'nextAction', v_next_action,
    'wateringLogged', false,
    'deduplicated', false
  );
end;
$function$;

revoke all on function atlas.grow_room_state_v1(uuid) from public;
grant execute on function atlas.grow_room_state_v1(uuid) to authenticated;
revoke all on function atlas.grow_room_record_batch_action_v1(uuid, uuid, text, text, numeric, text, date, uuid, uuid, text, jsonb) from public;
grant execute on function atlas.grow_room_record_batch_action_v1(uuid, uuid, text, text, numeric, text, date, uuid, uuid, text, jsonb) to authenticated;

comment on function atlas.grow_room_state_v1(uuid) is
  'Prepared membership-scoped Grow Room read. It returns physical objects, living batches, and action-bearing work without watering logs.';
comment on function atlas.grow_room_record_batch_action_v1(uuid, uuid, text, text, numeric, text, date, uuid, uuid, text, jsonb) is
  'Records only biological facts and action-bearing Grow Room transitions. Routine watering is explicitly rejected.';