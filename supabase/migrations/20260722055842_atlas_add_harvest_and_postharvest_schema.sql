create table atlas.postharvest_containers (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  resource_id uuid references atlas.resources(id) on delete set null,
  stable_key text not null,
  label text not null,
  container_type text not null check (container_type in ('bucket','tote','cooler_rack','other')),
  capacity_stems numeric check (capacity_stems is null or capacity_stems>0),
  status text not null default 'clean_available' check (status in ('clean_available','assigned','conditioning','cooling','ready_for_product','awaiting_wash','washing','damaged','retired')),
  location text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id,stable_key)
);

create table atlas.production_harvest_lots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  source_task_id uuid not null references atlas.tasks(id) on delete restrict,
  sequence_number integer not null check (sequence_number>0),
  lot_label text not null,
  harvest_date date not null,
  harvest_action text not null check (harvest_action in ('partial','complete')),
  status text not null default 'recorded' check (status in ('recorded','waiting_container_assignment','conditioning','cooling','ready_for_product','partially_released','released','closed','void')),
  stems_cut numeric not null check (stems_cut>=0),
  marketable_stems numeric not null check (marketable_stems>=0),
  seconds_stems numeric not null check (seconds_stems>=0),
  discarded_stems numeric not null check (discarded_stems>=0),
  readiness_estimated_marketable_stems numeric check (readiness_estimated_marketable_stems is null or readiness_estimated_marketable_stems>=0),
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id,sequence_number),
  unique (farm_id,idempotency_key),
  check (stems_cut=marketable_stems+seconds_stems+discarded_stems)
);

create table atlas.production_harvest_stand_entries (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  harvest_lot_id uuid not null references atlas.production_harvest_lots(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  field_stand_id uuid not null references atlas.production_field_stands(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  stems_cut numeric not null check (stems_cut>=0),
  marketable_stems numeric not null check (marketable_stems>=0),
  seconds_stems numeric not null check (seconds_stems>=0),
  discarded_stems numeric not null check (discarded_stems>=0),
  stand_harvest_status text not null check (stand_harvest_status in ('continuing','finished')),
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (harvest_lot_id,field_stand_id),
  check (stems_cut=marketable_stems+seconds_stems+discarded_stems)
);

create table atlas.production_harvest_container_assignments (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  harvest_lot_id uuid not null references atlas.production_harvest_lots(id) on delete cascade,
  container_id uuid not null references atlas.postharvest_containers(id) on delete restrict,
  assigned_stems numeric not null check (assigned_stems>0),
  assignment_status text not null default 'assigned' check (assignment_status in ('assigned','conditioning','cooling','ready_for_product','released','awaiting_wash','returned_clean','void')),
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id,idempotency_key),
  unique (harvest_lot_id,container_id)
);

create table atlas.postharvest_container_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  container_id uuid not null references atlas.postharvest_containers(id) on delete restrict,
  harvest_lot_id uuid references atlas.production_harvest_lots(id) on delete set null,
  assignment_id uuid references atlas.production_harvest_container_assignments(id) on delete set null,
  task_id uuid references atlas.tasks(id) on delete set null,
  event_type text not null check (event_type in ('assigned','conditioning_started','conditioned','cooling_started','cooled','released','wash_started','washed','damaged','retired')),
  event_date date not null,
  quantity numeric check (quantity is null or quantity>=0),
  unit text,
  note text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key)
);

create table atlas.production_postharvest_gates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  harvest_lot_id uuid not null references atlas.production_harvest_lots(id) on delete cascade,
  required_custody_stems numeric not null check (required_custody_stems>=0),
  assigned_stems numeric not null default 0 check (assigned_stems>=0),
  conditioned_stems numeric not null default 0 check (conditioned_stems>=0),
  cooled_stems numeric not null default 0 check (cooled_stems>=0),
  released_stems numeric not null default 0 check (released_stems>=0),
  gate_status text not null default 'waiting_container_assignment' check (gate_status in ('waiting_container_assignment','waiting_conditioning','waiting_cooling','ready_for_product','partially_released','released','closed','void')),
  blocker_text text,
  owner_assignment_task_id uuid references atlas.tasks(id) on delete set null,
  conditioning_task_id uuid references atlas.tasks(id) on delete set null,
  wash_task_id uuid references atlas.tasks(id) on delete set null,
  refresh_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (harvest_lot_id),
  check (assigned_stems<=required_custody_stems),
  check (conditioned_stems<=assigned_stems),
  check (cooled_stems<=conditioned_stems),
  check (released_stems<=cooled_stems)
);

create index postharvest_containers_farm_status_idx on atlas.postharvest_containers(farm_id,status);
create index production_harvest_lots_lot_date_idx on atlas.production_harvest_lots(production_lot_id,harvest_date desc);
create index production_harvest_stand_entries_field_stand_idx on atlas.production_harvest_stand_entries(field_stand_id);
create index production_harvest_container_assignments_container_status_idx on atlas.production_harvest_container_assignments(container_id,assignment_status);
create unique index production_harvest_container_active_assignment_uidx on atlas.production_harvest_container_assignments(container_id)
  where assignment_status in ('assigned','conditioning','cooling','ready_for_product','awaiting_wash');
create index postharvest_container_events_container_date_idx on atlas.postharvest_container_events(container_id,event_date desc,created_at desc);
create index production_postharvest_gates_status_idx on atlas.production_postharvest_gates(farm_id,gate_status);

create trigger postharvest_containers_set_updated_at before update on atlas.postharvest_containers for each row execute function atlas.set_updated_at();
create trigger production_harvest_lots_set_updated_at before update on atlas.production_harvest_lots for each row execute function atlas.set_updated_at();
create trigger production_harvest_container_assignments_set_updated_at before update on atlas.production_harvest_container_assignments for each row execute function atlas.set_updated_at();
create trigger production_postharvest_gates_set_updated_at before update on atlas.production_postharvest_gates for each row execute function atlas.set_updated_at();

create or replace function atlas.prevent_postharvest_ledger_mutation_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
begin
  raise exception 'Harvest and postharvest ledger records are append-only; record a correcting event instead';
end;$$;

create trigger production_harvest_stand_entries_append_only before update or delete on atlas.production_harvest_stand_entries for each row execute function atlas.prevent_postharvest_ledger_mutation_v1();
create trigger postharvest_container_events_append_only before update or delete on atlas.postharvest_container_events for each row execute function atlas.prevent_postharvest_ledger_mutation_v1();

create or replace function atlas.validate_production_harvest_stand_entry_v1()
returns trigger language plpgsql set search_path=pg_catalog,atlas as $$
declare
  v_harvest atlas.production_harvest_lots%rowtype;
  v_stand atlas.production_field_stands%rowtype;
begin
  select * into v_harvest from atlas.production_harvest_lots where id=new.harvest_lot_id;
  select * into v_stand from atlas.production_field_stands where id=new.field_stand_id;
  if v_harvest.id is null or v_stand.id is null
     or v_harvest.farm_id is distinct from new.farm_id
     or v_harvest.production_lot_id is distinct from new.production_lot_id
     or v_stand.farm_id is distinct from new.farm_id
     or v_stand.production_lot_id is distinct from new.production_lot_id
     or v_stand.object_id is distinct from new.object_id
     or v_stand.crop_cycle_id is distinct from new.crop_cycle_id then
    raise exception 'Harvest stand entries must stay with the same farm, production lot, bed, and crop cycle';
  end if;
  return new;
end;$$;
create trigger production_harvest_stand_entries_validate before insert on atlas.production_harvest_stand_entries for each row execute function atlas.validate_production_harvest_stand_entry_v1();

create or replace function atlas.validate_harvest_container_assignment_v1()
returns trigger language plpgsql set search_path=pg_catalog,atlas as $$
declare
  v_harvest atlas.production_harvest_lots%rowtype;
  v_container atlas.postharvest_containers%rowtype;
  v_prior numeric;
begin
  select * into v_harvest from atlas.production_harvest_lots where id=new.harvest_lot_id;
  select * into v_container from atlas.postharvest_containers where id=new.container_id;
  if v_harvest.id is null or v_container.id is null
     or v_harvest.farm_id is distinct from new.farm_id
     or v_container.farm_id is distinct from new.farm_id then
    raise exception 'Harvest container assignments must stay inside one farm';
  end if;
  if v_container.status in ('damaged','retired') then
    raise exception 'Damaged or retired containers cannot receive a harvest';
  end if;
  select coalesce(sum(assigned_stems),0) into v_prior
  from atlas.production_harvest_container_assignments
  where container_id=new.container_id
    and assignment_status in ('assigned','conditioning','cooling','ready_for_product','awaiting_wash');
  if v_container.capacity_stems is not null and v_prior+new.assigned_stems>v_container.capacity_stems then
    raise exception 'Container assignment exceeds measured stem capacity';
  end if;
  return new;
end;$$;
create trigger production_harvest_container_assignments_validate before insert on atlas.production_harvest_container_assignments for each row execute function atlas.validate_harvest_container_assignment_v1();