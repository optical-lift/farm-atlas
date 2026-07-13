-- Atlas Phase 3: transactional object workbench and quick log.
-- The canonical object is the write target. One RPC records the field log,
-- object link, canonical event, state update, and crop milestone atomically.

alter table atlas.object_activity_events
  add column if not exists field_log_id uuid references atlas.field_logs(id) on delete set null,
  add column if not exists crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  add column if not exists plant_instance_id uuid references atlas.plant_instances(id) on delete set null,
  add column if not exists idempotency_key text;

create index if not exists object_activity_events_object_timeline_idx
  on atlas.object_activity_events (object_id, event_date desc, created_at desc);

create index if not exists object_activity_events_field_log_idx
  on atlas.object_activity_events (field_log_id)
  where field_log_id is not null;

create index if not exists object_activity_events_crop_cycle_idx
  on atlas.object_activity_events (crop_cycle_id)
  where crop_cycle_id is not null;

create index if not exists object_activity_events_plant_instance_idx
  on atlas.object_activity_events (plant_instance_id)
  where plant_instance_id is not null;

create unique index if not exists object_activity_events_idempotency_idx
  on atlas.object_activity_events (farm_id, idempotency_key)
  where idempotency_key is not null;

insert into atlas.object_state (object_id, farm_id)
select go.id, go.farm_id
from atlas.growing_objects go
left join atlas.object_state os on os.object_id = go.id
where os.object_id is null
on conflict (object_id) do nothing;

create or replace view atlas.v_object_workbench
with (security_invoker = true)
as
select
  f.id as farm_id,
  f.stable_key as farm_key,
  z.id as zone_id,
  z.stable_key as zone_key,
  z.label as zone_label,
  go.id as object_id,
  go.stable_key as object_key,
  go.label as object_label,
  go.object_type,
  go.object_mode,
  go.length_ft,
  go.width_ft,
  go.area_sqft,
  go.guest_visible,
  go.metadata as object_metadata,
  os.life_status,
  os.weed_pressure,
  os.water_status,
  os.last_touched_at,
  os.last_weeded_at,
  os.last_watered_at,
  os.last_checked_at,
  os.decision_required,
  os.harvest_confidence,
  os.presentability,
  coalesce(cycles.active_crop_cycle_count, 0) as active_crop_cycle_count,
  coalesce(plants.current_plant_instance_count, 0) as current_plant_instance_count,
  latest.event_id as latest_event_id,
  latest.event_type as latest_event_type,
  latest.event_date as latest_event_date,
  latest.event_note as latest_event_note
from atlas.growing_objects go
join atlas.farms f on f.id = go.farm_id
left join atlas.zones z on z.id = go.zone_id
left join atlas.object_state os on os.object_id = go.id
left join lateral (
  select count(*)::integer as active_crop_cycle_count
  from atlas.crop_cycles cc
  where cc.object_id = go.id
    and cc.lifecycle_status = 'active'
) cycles on true
left join lateral (
  select count(*)::integer as current_plant_instance_count
  from atlas.plant_instances pi
  where pi.object_id = go.id
    and pi.status not in ('dead', 'removed', 'archived')
) plants on true
left join lateral (
  select
    e.id as event_id,
    e.event_type,
    e.event_date,
    e.note as event_note
  from atlas.object_activity_events e
  where e.object_id = go.id
  order by e.event_date desc, e.created_at desc
  limit 1
) latest on true;

create or replace view atlas.v_object_event_timeline
with (security_invoker = true)
as
select
  e.id as event_id,
  e.farm_id,
  go.stable_key as object_key,
  go.label as object_label,
  e.object_id,
  e.field_log_id,
  e.crop_cycle_id,
  e.plant_instance_id,
  coalesce(cc.crop_label, pi.label) as entity_label,
  case
    when e.crop_cycle_id is not null then 'crop_cycle'
    when e.plant_instance_id is not null then 'plant_instance'
    else 'object'
  end as entity_kind,
  e.event_type,
  e.event_date,
  e.note,
  e.quantity,
  e.unit,
  e.source,
  e.metadata,
  e.created_at
from atlas.object_activity_events e
join atlas.growing_objects go on go.id = e.object_id
left join atlas.crop_cycles cc on cc.id = e.crop_cycle_id
left join atlas.plant_instances pi on pi.id = e.plant_instance_id;

create or replace function atlas.record_object_event_v1(
  p_farm_key text,
  p_object_key text,
  p_event_type text,
  p_event_date date default current_date,
  p_note text default null,
  p_quantity numeric default null,
  p_unit text default null,
  p_crop_cycle_id uuid default null,
  p_plant_instance_id uuid default null,
  p_state jsonb default '{}'::jsonb,
  p_idempotency_key text default null
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, atlas
as $$
declare
  v_farm_id uuid;
  v_object atlas.growing_objects%rowtype;
  v_event_id uuid;
  v_field_log_id uuid;
  v_existing_event record;
  v_action_label text;
  v_event_date date := coalesce(p_event_date, current_date);
  v_note text := nullif(btrim(p_note), '');
  v_unit text := nullif(btrim(p_unit), '');
  v_idempotency_key text := nullif(btrim(p_idempotency_key), '');
  v_weed_pressure text;
  v_water_status text;
  v_life_status text;
  v_harvest_confidence text;
  v_presentability text;
  v_decision_required boolean;
begin
  if p_farm_key is null or btrim(p_farm_key) = '' then
    raise exception 'Farm key is required.' using errcode = '22023';
  end if;

  if p_object_key is null or btrim(p_object_key) = '' then
    raise exception 'Object key is required.' using errcode = '22023';
  end if;

  if p_event_type not in (
    'observed', 'checked', 'weeded', 'watered', 'sowed', 'planted',
    'germinated', 'pinched', 'bloom_started', 'harvested',
    'maintained', 'cleared', 'blocked'
  ) then
    raise exception 'Unsupported object event type: %', p_event_type using errcode = '22023';
  end if;

  if p_state is null then
    p_state := '{}'::jsonb;
  elsif jsonb_typeof(p_state) <> 'object' then
    raise exception 'State must be a JSON object.' using errcode = '22023';
  end if;

  if v_note is not null and length(v_note) > 4000 then
    raise exception 'Note must be 4000 characters or fewer.' using errcode = '22023';
  end if;

  if v_unit is not null and length(v_unit) > 40 then
    raise exception 'Unit must be 40 characters or fewer.' using errcode = '22023';
  end if;

  if v_idempotency_key is not null and length(v_idempotency_key) > 160 then
    raise exception 'Idempotency key must be 160 characters or fewer.' using errcode = '22023';
  end if;

  if p_quantity is not null and p_quantity < 0 then
    raise exception 'Quantity cannot be negative.' using errcode = '22023';
  end if;

  if p_crop_cycle_id is not null and p_plant_instance_id is not null then
    raise exception 'Choose either a crop cycle or a permanent plant, not both.' using errcode = '22023';
  end if;

  select f.id into v_farm_id
  from atlas.farms f
  where f.stable_key = p_farm_key;

  if v_farm_id is null then
    raise exception 'Farm was not found.' using errcode = 'P0002';
  end if;

  select go.* into v_object
  from atlas.growing_objects go
  where go.farm_id = v_farm_id
    and go.stable_key = p_object_key;

  if v_object.id is null then
    raise exception 'Farm object was not found.' using errcode = 'P0002';
  end if;

  if v_idempotency_key is not null then
    select e.id, e.field_log_id into v_existing_event
    from atlas.object_activity_events e
    where e.farm_id = v_farm_id
      and e.idempotency_key = v_idempotency_key;

    if v_existing_event.id is not null then
      return jsonb_build_object(
        'eventId', v_existing_event.id,
        'fieldLogId', v_existing_event.field_log_id,
        'objectId', v_object.id,
        'objectKey', v_object.stable_key,
        'eventType', p_event_type,
        'eventDate', v_event_date,
        'deduplicated', true
      );
    end if;
  end if;

  if p_crop_cycle_id is not null and not exists (
    select 1
    from atlas.crop_cycles cc
    where cc.id = p_crop_cycle_id
      and cc.farm_id = v_farm_id
      and cc.object_id = v_object.id
      and cc.lifecycle_status = 'active'
  ) then
    raise exception 'Active crop cycle is not attached to this object.' using errcode = '22023';
  end if;

  if p_plant_instance_id is not null and not exists (
    select 1
    from atlas.plant_instances pi
    where pi.id = p_plant_instance_id
      and pi.farm_id = v_farm_id
      and pi.object_id = v_object.id
      and pi.status not in ('dead', 'removed', 'archived')
  ) then
    raise exception 'Current plant instance is not attached to this object.' using errcode = '22023';
  end if;

  v_action_label := case p_event_type
    when 'observed' then 'Observation'
    when 'checked' then 'Check'
    when 'weeded' then 'Weeding'
    when 'watered' then 'Watering'
    when 'sowed' then 'Sowing'
    when 'planted' then 'Planting'
    when 'germinated' then 'Germination'
    when 'pinched' then 'Pinching'
    when 'bloom_started' then 'Bloom'
    when 'harvested' then 'Harvest'
    when 'maintained' then 'Maintenance'
    when 'cleared' then 'Clear bed'
    when 'blocked' then 'Blocked'
  end;

  insert into atlas.field_logs (
    farm_id,
    log_date,
    action_types,
    summary_sentence,
    note,
    created_by,
    source,
    metadata
  ) values (
    v_farm_id,
    v_event_date,
    array[p_event_type],
    v_action_label || ' · ' || v_object.label,
    v_note,
    'atlas_phase_3',
    'atlas_object_quick_log',
    jsonb_build_object(
      'version', 'object_event_v1',
      'object_id', v_object.id,
      'object_key', v_object.stable_key,
      'crop_cycle_id', p_crop_cycle_id,
      'plant_instance_id', p_plant_instance_id
    )
  )
  returning id into v_field_log_id;

  insert into atlas.field_log_objects (
    field_log_id,
    zone_id,
    object_id,
    role
  ) values (
    v_field_log_id,
    v_object.zone_id,
    v_object.id,
    'touched'
  );

  insert into atlas.object_activity_events (
    farm_id,
    object_id,
    field_log_id,
    crop_cycle_id,
    plant_instance_id,
    event_type,
    event_date,
    note,
    quantity,
    unit,
    created_by,
    source,
    idempotency_key,
    metadata
  ) values (
    v_farm_id,
    v_object.id,
    v_field_log_id,
    p_crop_cycle_id,
    p_plant_instance_id,
    p_event_type,
    v_event_date,
    v_note,
    p_quantity,
    v_unit,
    'atlas_phase_3',
    'atlas_object_quick_log',
    v_idempotency_key,
    jsonb_build_object(
      'version', 'object_event_v1',
      'state', p_state
    )
  )
  returning id into v_event_id;

  v_weed_pressure := nullif(btrim(p_state ->> 'weed_pressure'), '');
  v_water_status := nullif(btrim(p_state ->> 'water_status'), '');
  v_life_status := nullif(btrim(p_state ->> 'life_status'), '');
  v_harvest_confidence := nullif(btrim(p_state ->> 'harvest_confidence'), '');
  v_presentability := nullif(btrim(p_state ->> 'presentability'), '');
  v_decision_required := case
    when p_state ? 'decision_required' then (p_state ->> 'decision_required')::boolean
    else null
  end;

  if greatest(
    coalesce(length(v_weed_pressure), 0),
    coalesce(length(v_water_status), 0),
    coalesce(length(v_life_status), 0),
    coalesce(length(v_harvest_confidence), 0),
    coalesce(length(v_presentability), 0)
  ) > 60 then
    raise exception 'State labels must be 60 characters or fewer.' using errcode = '22023';
  end if;

  insert into atlas.object_state (
    object_id,
    farm_id,
    life_status,
    weed_pressure,
    water_status,
    last_touched_at,
    last_weeded_at,
    last_watered_at,
    last_checked_at,
    decision_required,
    harvest_confidence,
    presentability,
    metadata
  ) values (
    v_object.id,
    v_farm_id,
    coalesce(v_life_status, 'open'),
    coalesce(v_weed_pressure, 'unknown'),
    coalesce(v_water_status, case when p_event_type = 'watered' then 'irrigated' else 'unknown' end),
    v_event_date,
    case when p_event_type = 'weeded' then v_event_date end,
    case when p_event_type = 'watered' then v_event_date end,
    case when p_event_type in ('observed', 'checked') then v_event_date end,
    coalesce(v_decision_required, false),
    coalesce(v_harvest_confidence, 'unknown'),
    coalesce(v_presentability, 'unknown'),
    jsonb_build_object('last_object_event_id', v_event_id)
  )
  on conflict (object_id) do update set
    last_touched_at = case
      when atlas.object_state.last_touched_at is null then excluded.last_touched_at
      else greatest(atlas.object_state.last_touched_at, excluded.last_touched_at)
    end,
    last_weeded_at = case
      when excluded.last_weeded_at is null then atlas.object_state.last_weeded_at
      when atlas.object_state.last_weeded_at is null then excluded.last_weeded_at
      else greatest(atlas.object_state.last_weeded_at, excluded.last_weeded_at)
    end,
    last_watered_at = case
      when excluded.last_watered_at is null then atlas.object_state.last_watered_at
      when atlas.object_state.last_watered_at is null then excluded.last_watered_at
      else greatest(atlas.object_state.last_watered_at, excluded.last_watered_at)
    end,
    last_checked_at = case
      when excluded.last_checked_at is null then atlas.object_state.last_checked_at
      when atlas.object_state.last_checked_at is null then excluded.last_checked_at
      else greatest(atlas.object_state.last_checked_at, excluded.last_checked_at)
    end,
    life_status = coalesce(v_life_status, atlas.object_state.life_status),
    weed_pressure = coalesce(v_weed_pressure, atlas.object_state.weed_pressure),
    water_status = coalesce(
      v_water_status,
      case when p_event_type = 'watered' then 'irrigated' end,
      atlas.object_state.water_status
    ),
    decision_required = coalesce(v_decision_required, atlas.object_state.decision_required),
    harvest_confidence = coalesce(v_harvest_confidence, atlas.object_state.harvest_confidence),
    presentability = coalesce(v_presentability, atlas.object_state.presentability),
    metadata = atlas.object_state.metadata || jsonb_build_object('last_object_event_id', v_event_id),
    updated_at = now();

  if p_crop_cycle_id is not null then
    update atlas.crop_cycles cc
    set
      sown_date = case when p_event_type = 'sowed' then coalesce(cc.sown_date, v_event_date) else cc.sown_date end,
      planted_date = case when p_event_type = 'planted' then coalesce(cc.planted_date, v_event_date) else cc.planted_date end,
      germination_checked_date = case when p_event_type = 'germinated' then coalesce(cc.germination_checked_date, v_event_date) else cc.germination_checked_date end,
      harvest_started_date = case when p_event_type = 'harvested' then coalesce(cc.harvest_started_date, v_event_date) else cc.harvest_started_date end,
      last_harvest_date = case
        when p_event_type <> 'harvested' then cc.last_harvest_date
        when cc.last_harvest_date is null then v_event_date
        else greatest(cc.last_harvest_date, v_event_date)
      end,
      cleared_date = case when p_event_type = 'cleared' then coalesce(cc.cleared_date, v_event_date) else cc.cleared_date end,
      cycle_state = case
        when p_event_type = 'sowed' then 'sown'
        when p_event_type in ('planted', 'germinated') then 'growing'
        when p_event_type = 'bloom_started' then 'flowering'
        when p_event_type = 'harvested' then 'harvesting'
        when p_event_type = 'cleared' then 'cleared'
        else cc.cycle_state
      end,
      lifecycle_status = case when p_event_type = 'cleared' then 'complete' else cc.lifecycle_status end,
      updated_at = now()
    where cc.id = p_crop_cycle_id;
  end if;

  if p_plant_instance_id is not null and p_event_type = 'planted' then
    update atlas.plant_instances pi
    set
      planted_date = coalesce(pi.planted_date, v_event_date),
      updated_at = now()
    where pi.id = p_plant_instance_id;
  end if;

  return jsonb_build_object(
    'eventId', v_event_id,
    'fieldLogId', v_field_log_id,
    'objectId', v_object.id,
    'objectKey', v_object.stable_key,
    'eventType', p_event_type,
    'eventDate', v_event_date,
    'deduplicated', false
  );
end;
$$;

revoke all on atlas.v_object_workbench from public, anon, authenticated;
revoke all on atlas.v_object_event_timeline from public, anon, authenticated;
revoke all on function atlas.record_object_event_v1(
  text, text, text, date, text, numeric, text, uuid, uuid, jsonb, text
) from public, anon, authenticated;

grant select on atlas.v_object_workbench to service_role;
grant select on atlas.v_object_event_timeline to service_role;
grant execute on function atlas.record_object_event_v1(
  text, text, text, date, text, numeric, text, uuid, uuid, jsonb, text
) to service_role;

grant select on atlas.plant_lineages to service_role;
grant select, insert, update on atlas.field_logs to service_role;
grant select, insert, update on atlas.field_log_objects to service_role;
grant select, insert, update on atlas.object_activity_events to service_role;
grant select, insert, update on atlas.object_state to service_role;
grant select, update on atlas.crop_cycles to service_role;
grant select, update on atlas.plant_instances to service_role;

insert into atlas.truth_sources (
  farm_id,
  stable_key,
  label,
  source_type,
  source_date,
  authority_rank,
  metadata
)
select
  f.id,
  'atlas_phase_3_object_workbench_20260713',
  'Atlas Phase 3 transactional object workbench',
  'system',
  date '2026-07-13',
  90,
  jsonb_build_object(
    'phase', 3,
    'method', 'record_object_event_v1',
    'atomic_writes', true,
    'destructive_deletes', false
  )
from atlas.farms f
where f.stable_key = 'elm_farm'
on conflict (farm_id, stable_key) do nothing;

insert into atlas.integrity_audit_runs (
  farm_id,
  audit_version,
  metrics,
  source_id,
  created_by,
  note
)
select
  f.id,
  'phase_3_object_workbench_v1',
  jsonb_build_object(
    'growing_objects', (select count(*) from atlas.growing_objects go where go.farm_id = f.id),
    'objects_with_state', (select count(*) from atlas.object_state os where os.farm_id = f.id),
    'atomic_write_function', 'record_object_event_v1',
    'public_execute_granted', false
  ),
  s.id,
  'codex',
  'Phase 3 makes a physical object the transactional target for field logs, canonical events, state, and crop milestones.'
from atlas.farms f
join atlas.truth_sources s
  on s.farm_id = f.id
 and s.stable_key = 'atlas_phase_3_object_workbench_20260713'
where f.stable_key = 'elm_farm'
on conflict (farm_id, audit_version) do nothing;

notify pgrst, 'reload schema';

do $$
declare
  object_count bigint;
  state_count bigint;
  public_execute boolean;
begin
  select count(*) into object_count
  from atlas.growing_objects go
  join atlas.farms f on f.id = go.farm_id
  where f.stable_key = 'elm_farm';

  select count(*) into state_count
  from atlas.object_state os
  join atlas.farms f on f.id = os.farm_id
  where f.stable_key = 'elm_farm';

  if object_count <> state_count then
    raise exception 'Phase 3 state coverage failed: % objects, % state rows', object_count, state_count;
  end if;

  select has_function_privilege(
    'anon',
    'atlas.record_object_event_v1(text,text,text,date,text,numeric,text,uuid,uuid,jsonb,text)',
    'EXECUTE'
  ) into public_execute;

  if public_execute then
    raise exception 'Phase 3 security check failed: anon can execute object event RPC';
  end if;
end;
$$;
