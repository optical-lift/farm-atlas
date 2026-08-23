create table atlas.capacity_pools (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  label text not null,
  capacity_kind text not null check (capacity_kind in ('tray_inventory','shelf_positions','lit_shelf_positions','bed_feet','bucket_inventory','other')),
  resource_id uuid references atlas.resources(id) on delete restrict,
  object_id uuid references atlas.growing_objects(id) on delete restrict,
  total_capacity numeric,
  unit text not null,
  capacity_status text not null default 'unconfirmed' check (capacity_status in ('confirmed','unconfirmed','unavailable','retired')),
  active boolean not null default true,
  source text not null default 'manual',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (not (resource_id is not null and object_id is not null)),
  check (total_capacity is null or total_capacity >= 0)
);

create table atlas.capacity_measurements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  label text not null,
  measurement_kind text not null check (measurement_kind in ('count','conversion','duration_days','percentage','spacing_inches','rows_per_bed','lead_days')),
  value numeric not null check (value > 0),
  unit text not null,
  confidence text not null default 'measured' check (confidence in ('measured','confirmed','estimated')),
  source_task_id uuid references atlas.tasks(id) on delete set null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key)
);

create table atlas.capacity_questions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_program_id uuid references atlas.production_programs(id) on delete cascade,
  stable_key text not null,
  question_kind text not null check (question_kind in ('inventory_count','conversion','duration','planning_assumption','placement','lead_time')),
  question_text text not null,
  answer_value numeric,
  answer_unit text,
  answer_text text,
  status text not null default 'open' check (status in ('open','answered','retired')),
  source_task_id uuid references atlas.tasks(id) on delete set null,
  answered_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check ((status = 'answered' and (answer_value is not null or nullif(answer_text,'') is not null) and answered_at is not null) or status <> 'answered')
);

create table atlas.production_capacity_requirements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  stable_key text not null,
  stage_key text not null,
  capacity_kind text not null check (capacity_kind in ('seed','soil_blocks','trays','shelf_positions','lit_shelf_positions','bed_feet','buckets','other')),
  quantity_needed numeric,
  unit text not null,
  required_by_date date,
  window_start date,
  window_end date,
  preparation_due_date date,
  calculation_status text not null default 'blocked' check (calculation_status in ('blocked','calculated','confirmed','not_required')),
  source text not null default 'planner',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id, stable_key),
  check (quantity_needed is null or quantity_needed >= 0),
  check (window_end is null or window_start is null or window_end >= window_start),
  check (preparation_due_date is null or required_by_date is null or preparation_due_date <= required_by_date)
);

create table atlas.capacity_requirement_questions (
  id uuid primary key default gen_random_uuid(),
  requirement_id uuid not null references atlas.production_capacity_requirements(id) on delete cascade,
  question_id uuid not null references atlas.capacity_questions(id) on delete cascade,
  blocker_role text not null default 'calculation_input',
  created_at timestamptz not null default now(),
  unique (requirement_id, question_id)
);

create table atlas.production_capacity_reservations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  requirement_id uuid not null references atlas.production_capacity_requirements(id) on delete cascade,
  capacity_pool_id uuid not null references atlas.capacity_pools(id) on delete restrict,
  quantity_reserved numeric not null check (quantity_reserved > 0),
  unit text not null,
  window_start date not null,
  window_end date not null,
  reservation_status text not null default 'tentative' check (reservation_status in ('tentative','confirmed','released','consumed')),
  source text not null default 'planner',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (requirement_id, capacity_pool_id, window_start, window_end),
  check (window_end >= window_start)
);

create index capacity_pools_farm_kind_idx on atlas.capacity_pools(farm_id, capacity_kind) where active;
create index capacity_questions_program_status_idx on atlas.capacity_questions(production_program_id, status);
create index production_capacity_requirements_lot_idx on atlas.production_capacity_requirements(production_lot_id, capacity_kind);
create index production_capacity_reservations_pool_window_idx on atlas.production_capacity_reservations(capacity_pool_id, window_start, window_end) where reservation_status in ('tentative','confirmed');

create trigger capacity_pools_set_updated_at before update on atlas.capacity_pools for each row execute function atlas.set_updated_at();
create trigger capacity_measurements_set_updated_at before update on atlas.capacity_measurements for each row execute function atlas.set_updated_at();
create trigger capacity_questions_set_updated_at before update on atlas.capacity_questions for each row execute function atlas.set_updated_at();
create trigger production_capacity_requirements_set_updated_at before update on atlas.production_capacity_requirements for each row execute function atlas.set_updated_at();
create trigger production_capacity_reservations_set_updated_at before update on atlas.production_capacity_reservations for each row execute function atlas.set_updated_at();

create or replace function atlas.validate_capacity_pool_v1()
returns trigger language plpgsql set search_path = atlas, public as $$
declare linked_farm uuid;
begin
  if new.resource_id is not null then
    select farm_id into linked_farm from atlas.resources where id = new.resource_id;
    if linked_farm is distinct from new.farm_id then raise exception 'Capacity pool resource must belong to the same farm'; end if;
  end if;
  if new.object_id is not null then
    select farm_id into linked_farm from atlas.growing_objects where id = new.object_id;
    if linked_farm is distinct from new.farm_id then raise exception 'Capacity pool object must belong to the same farm'; end if;
  end if;
  return new;
end; $$;
create trigger capacity_pools_validate before insert or update on atlas.capacity_pools for each row execute function atlas.validate_capacity_pool_v1();

create or replace function atlas.validate_capacity_question_v1()
returns trigger language plpgsql set search_path = atlas, public as $$
declare linked_farm uuid;
begin
  if new.production_program_id is not null then
    select farm_id into linked_farm from atlas.production_programs where id = new.production_program_id;
    if linked_farm is distinct from new.farm_id then raise exception 'Capacity question program must belong to the same farm'; end if;
  end if;
  if new.source_task_id is not null then
    select farm_id into linked_farm from atlas.tasks where id = new.source_task_id;
    if linked_farm is distinct from new.farm_id then raise exception 'Capacity question task must belong to the same farm'; end if;
  end if;
  return new;
end; $$;
create trigger capacity_questions_validate before insert or update on atlas.capacity_questions for each row execute function atlas.validate_capacity_question_v1();

create or replace function atlas.validate_production_capacity_requirement_v1()
returns trigger language plpgsql set search_path = atlas, public as $$
declare linked_farm uuid;
begin
  select farm_id into linked_farm from atlas.production_lots where id = new.production_lot_id;
  if linked_farm is distinct from new.farm_id then raise exception 'Capacity requirement and production lot must belong to the same farm'; end if;
  if new.calculation_status in ('calculated','confirmed') and new.quantity_needed is null then raise exception 'Calculated or confirmed capacity requirements need a quantity'; end if;
  return new;
end; $$;
create trigger production_capacity_requirements_validate before insert or update on atlas.production_capacity_requirements for each row execute function atlas.validate_production_capacity_requirement_v1();

create or replace function atlas.validate_production_capacity_reservation_v1()
returns trigger language plpgsql set search_path = atlas, public as $$
declare lot_farm uuid; req_farm uuid; req_lot uuid; req_unit text; pool_farm uuid; pool_unit text;
begin
  select farm_id into lot_farm from atlas.production_lots where id = new.production_lot_id;
  select farm_id, production_lot_id, unit into req_farm, req_lot, req_unit from atlas.production_capacity_requirements where id = new.requirement_id;
  select farm_id, unit into pool_farm, pool_unit from atlas.capacity_pools where id = new.capacity_pool_id;
  if lot_farm is distinct from new.farm_id or req_farm is distinct from new.farm_id or pool_farm is distinct from new.farm_id then raise exception 'Capacity reservation records must belong to the same farm'; end if;
  if req_lot is distinct from new.production_lot_id then raise exception 'Capacity reservation requirement must belong to the production lot'; end if;
  if req_unit is distinct from new.unit or pool_unit is distinct from new.unit then raise exception 'Capacity reservation units must match requirement and pool units'; end if;
  return new;
end; $$;
create trigger production_capacity_reservations_validate before insert or update on atlas.production_capacity_reservations for each row execute function atlas.validate_production_capacity_reservation_v1();

alter table atlas.capacity_pools enable row level security;
alter table atlas.capacity_measurements enable row level security;
alter table atlas.capacity_questions enable row level security;
alter table atlas.production_capacity_requirements enable row level security;
alter table atlas.capacity_requirement_questions enable row level security;
alter table atlas.production_capacity_reservations enable row level security;

revoke all on atlas.capacity_pools from public, anon, authenticated;
revoke all on atlas.capacity_measurements from public, anon, authenticated;
revoke all on atlas.capacity_questions from public, anon, authenticated;
revoke all on atlas.production_capacity_requirements from public, anon, authenticated;
revoke all on atlas.capacity_requirement_questions from public, anon, authenticated;
revoke all on atlas.production_capacity_reservations from public, anon, authenticated;

grant select, insert, update, delete on atlas.capacity_pools to service_role;
grant select, insert, update, delete on atlas.capacity_measurements to service_role;
grant select, insert, update, delete on atlas.capacity_questions to service_role;
grant select, insert, update, delete on atlas.production_capacity_requirements to service_role;
grant select, insert, update, delete on atlas.capacity_requirement_questions to service_role;
grant select, insert, update, delete on atlas.production_capacity_reservations to service_role;

revoke execute on function atlas.validate_capacity_pool_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_capacity_question_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_production_capacity_requirement_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_production_capacity_reservation_v1() from public, anon, authenticated;