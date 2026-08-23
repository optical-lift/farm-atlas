create table atlas.production_programs (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  stable_key text not null,
  season_year integer not null check (season_year between 2000 and 2200),
  program_label text not null,
  program_kind text not null,
  promise_text text not null,
  intended_uses text[] not null default '{}',
  target_harvest_start date,
  target_harvest_end date,
  target_output_quantity numeric,
  target_output_unit text,
  target_revenue numeric,
  currency text not null default 'USD',
  status text not null default 'planned' check (status in ('planned','active','paused','completed','cancelled')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (target_harvest_end is null or target_harvest_start is null or target_harvest_end >= target_harvest_start),
  check (target_output_quantity is null or target_output_quantity >= 0),
  check (target_revenue is null or target_revenue >= 0)
);

create table atlas.seed_lots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  crop_profile_id uuid references atlas.crop_profiles(id) on delete set null,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  stable_key text not null,
  lot_label text not null,
  crop_label text not null,
  variety text,
  source_type text not null default 'purchase' check (source_type in ('purchase','saved_seed','gift','transferred','existing_inventory','unknown')),
  supplier text,
  supplier_lot_code text,
  acquired_date date,
  received_quantity numeric not null check (received_quantity >= 0),
  quantity_unit text not null default 'seeds',
  purchase_cost numeric check (purchase_cost is null or purchase_cost >= 0),
  currency text not null default 'USD',
  germination_rate numeric check (germination_rate is null or (germination_rate >= 0 and germination_rate <= 1)),
  storage_location text,
  status text not null default 'available' check (status in ('planned','ordered','received','available','depleted','quarantined','closed')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key)
);

create table atlas.production_lots (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  program_id uuid not null references atlas.production_programs(id) on delete cascade,
  crop_profile_id uuid references atlas.crop_profiles(id) on delete set null,
  production_plan_id uuid references atlas.production_plans(id) on delete set null,
  production_succession_id uuid references atlas.production_successions(id) on delete set null,
  stable_key text not null,
  lot_label text not null,
  succession_number integer,
  planned_input_quantity numeric check (planned_input_quantity is null or planned_input_quantity >= 0),
  planned_input_unit text not null default 'seeds',
  current_quantity numeric check (current_quantity is null or current_quantity >= 0),
  current_unit text,
  current_stage text not null default 'planned' check (length(btrim(current_stage)) > 0),
  lifecycle_status text not null default 'planned' check (lifecycle_status in ('planned','active','completed','failed','cancelled')),
  planned_sow_date date,
  actual_sow_date date,
  expected_transplant_start date,
  expected_transplant_end date,
  expected_harvest_start date,
  expected_harvest_end date,
  intended_uses text[] not null default '{}',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (farm_id, stable_key),
  check (expected_transplant_end is null or expected_transplant_start is null or expected_transplant_end >= expected_transplant_start),
  check (expected_harvest_end is null or expected_harvest_start is null or expected_harvest_end >= expected_harvest_start)
);

create table atlas.seed_lot_allocations (
  id uuid primary key default gen_random_uuid(),
  seed_lot_id uuid not null references atlas.seed_lots(id) on delete restrict,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  allocated_quantity numeric not null check (allocated_quantity > 0),
  unit text not null default 'seeds',
  allocation_status text not null default 'reserved' check (allocation_status in ('reserved','consumed','released','cancelled')),
  allocated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (seed_lot_id, production_lot_id)
);

create table atlas.production_lot_tasks (
  id uuid primary key default gen_random_uuid(),
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete cascade,
  link_role text not null,
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (production_lot_id, task_id, link_role)
);

create table atlas.production_lot_crop_cycles (
  id uuid primary key default gen_random_uuid(),
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete cascade,
  relation_role text not null default 'primary',
  confidence text not null default 'confirmed' check (confidence in ('confirmed','probable','possible')),
  source text not null default 'system',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (production_lot_id, crop_cycle_id, relation_role)
);

create table atlas.production_lot_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  event_type text not null check (length(btrim(event_type)) > 0),
  event_date date not null default current_date,
  quantity numeric check (quantity is null or quantity >= 0),
  unit text,
  task_id uuid references atlas.tasks(id) on delete set null,
  crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  object_id uuid references atlas.growing_objects(id) on delete set null,
  note text,
  source text not null default 'system',
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create index production_programs_farm_status_idx on atlas.production_programs (farm_id, status, season_year);
create index seed_lots_farm_crop_idx on atlas.seed_lots (farm_id, crop_profile_id, status);
create index production_lots_program_stage_idx on atlas.production_lots (program_id, lifecycle_status, current_stage);
create index production_lots_farm_sow_idx on atlas.production_lots (farm_id, planned_sow_date);
create index seed_lot_allocations_seed_idx on atlas.seed_lot_allocations (seed_lot_id, allocation_status);
create index production_lot_tasks_task_idx on atlas.production_lot_tasks (task_id);
create index production_lot_crop_cycles_cycle_idx on atlas.production_lot_crop_cycles (crop_cycle_id);
create index production_lot_events_lot_date_idx on atlas.production_lot_events (production_lot_id, event_date, created_at);

create trigger production_programs_set_updated_at before update on atlas.production_programs for each row execute function atlas.set_updated_at();
create trigger seed_lots_set_updated_at before update on atlas.seed_lots for each row execute function atlas.set_updated_at();
create trigger production_lots_set_updated_at before update on atlas.production_lots for each row execute function atlas.set_updated_at();
create trigger seed_lot_allocations_set_updated_at before update on atlas.seed_lot_allocations for each row execute function atlas.set_updated_at();

create or replace function atlas.validate_seed_lot_allocation_v1()
returns trigger language plpgsql security definer set search_path = atlas, pg_temp as $$
declare
  v_seed_farm uuid; v_seed_profile uuid; v_received numeric; v_seed_unit text;
  v_lot_farm uuid; v_lot_profile uuid; v_existing numeric;
begin
  select farm_id, crop_profile_id, received_quantity, quantity_unit into v_seed_farm, v_seed_profile, v_received, v_seed_unit from atlas.seed_lots where id = new.seed_lot_id;
  select farm_id, crop_profile_id into v_lot_farm, v_lot_profile from atlas.production_lots where id = new.production_lot_id;
  if v_seed_farm is null or v_lot_farm is null or v_seed_farm <> v_lot_farm then raise exception 'Seed lot and production lot must belong to the same farm'; end if;
  if v_seed_profile is not null and v_lot_profile is not null and v_seed_profile <> v_lot_profile then raise exception 'Seed lot and production lot crop profiles must match'; end if;
  if lower(btrim(new.unit)) <> lower(btrim(v_seed_unit)) then raise exception 'Allocation unit must match the seed lot unit'; end if;
  select coalesce(sum(allocated_quantity),0) into v_existing from atlas.seed_lot_allocations where seed_lot_id = new.seed_lot_id and allocation_status in ('reserved','consumed') and id <> new.id;
  if new.allocation_status in ('reserved','consumed') and v_existing + new.allocated_quantity > v_received then raise exception 'Seed allocation exceeds received inventory'; end if;
  return new;
end; $$;
create trigger validate_seed_lot_allocation before insert or update on atlas.seed_lot_allocations for each row execute function atlas.validate_seed_lot_allocation_v1();

create or replace function atlas.validate_production_lot_task_link_v1()
returns trigger language plpgsql security definer set search_path = atlas, pg_temp as $$
declare v_lot_farm uuid; v_task_farm uuid;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id = new.production_lot_id;
  select farm_id into v_task_farm from atlas.tasks where id = new.task_id;
  if v_lot_farm is null or v_task_farm is null or v_lot_farm <> v_task_farm then raise exception 'Production lot and task must belong to the same farm'; end if;
  return new;
end; $$;
create trigger validate_production_lot_task_link before insert or update on atlas.production_lot_tasks for each row execute function atlas.validate_production_lot_task_link_v1();

create or replace function atlas.validate_production_lot_cycle_link_v1()
returns trigger language plpgsql security definer set search_path = atlas, pg_temp as $$
declare v_lot_farm uuid; v_lot_profile uuid; v_cycle_farm uuid; v_cycle_profile uuid;
begin
  select farm_id, crop_profile_id into v_lot_farm, v_lot_profile from atlas.production_lots where id = new.production_lot_id;
  select farm_id, crop_profile_id into v_cycle_farm, v_cycle_profile from atlas.crop_cycles where id = new.crop_cycle_id;
  if v_lot_farm is null or v_cycle_farm is null or v_lot_farm <> v_cycle_farm then raise exception 'Production lot and crop cycle must belong to the same farm'; end if;
  if v_lot_profile is not null and v_cycle_profile is not null and v_lot_profile <> v_cycle_profile then raise exception 'Production lot and crop cycle profiles must match'; end if;
  return new;
end; $$;
create trigger validate_production_lot_cycle_link before insert or update on atlas.production_lot_crop_cycles for each row execute function atlas.validate_production_lot_cycle_link_v1();

create or replace function atlas.validate_production_lot_event_v1()
returns trigger language plpgsql security definer set search_path = atlas, pg_temp as $$
declare v_lot_farm uuid; v_related_farm uuid;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id = new.production_lot_id;
  if v_lot_farm is null or new.farm_id <> v_lot_farm then raise exception 'Production event farm must match its production lot'; end if;
  if new.task_id is not null then select farm_id into v_related_farm from atlas.tasks where id = new.task_id; if v_related_farm is null or v_related_farm <> v_lot_farm then raise exception 'Production event task must belong to the same farm'; end if; end if;
  if new.crop_cycle_id is not null then select farm_id into v_related_farm from atlas.crop_cycles where id = new.crop_cycle_id; if v_related_farm is null or v_related_farm <> v_lot_farm then raise exception 'Production event crop cycle must belong to the same farm'; end if; end if;
  if new.object_id is not null then select farm_id into v_related_farm from atlas.growing_objects where id = new.object_id; if v_related_farm is null or v_related_farm <> v_lot_farm then raise exception 'Production event object must belong to the same farm'; end if; end if;
  return new;
end; $$;
create trigger validate_production_lot_event before insert on atlas.production_lot_events for each row execute function atlas.validate_production_lot_event_v1();

create or replace function atlas.prevent_production_lot_event_mutation_v1()
returns trigger language plpgsql security definer set search_path = atlas, pg_temp as $$ begin raise exception 'Production lot events are append-only; write a correcting event instead'; end; $$;
create trigger prevent_production_lot_event_mutation before update or delete on atlas.production_lot_events for each row execute function atlas.prevent_production_lot_event_mutation_v1();

create view atlas.seed_lot_inventory_v1 as
select sl.id as seed_lot_id, sl.farm_id, sl.stable_key, sl.lot_label, sl.crop_profile_id, sl.crop_label, sl.variety, sl.supplier,
  sl.received_quantity, sl.quantity_unit,
  coalesce(sum(a.allocated_quantity) filter (where a.allocation_status = 'reserved'),0) as reserved_quantity,
  coalesce(sum(a.allocated_quantity) filter (where a.allocation_status = 'consumed'),0) as consumed_quantity,
  coalesce(sum(a.allocated_quantity) filter (where a.allocation_status = 'released'),0) as released_quantity,
  sl.received_quantity - coalesce(sum(a.allocated_quantity) filter (where a.allocation_status in ('reserved','consumed')),0) as available_quantity,
  (sl.received_quantity - coalesce(sum(a.allocated_quantity) filter (where a.allocation_status in ('reserved','consumed')),0)) < 0 as overallocated,
  sl.purchase_cost, sl.currency, sl.status, sl.metadata
from atlas.seed_lots sl left join atlas.seed_lot_allocations a on a.seed_lot_id = sl.id group by sl.id;

create view atlas.production_lot_lineage_v1 as
select pp.farm_id, pp.id as program_id, pp.stable_key as program_key, pp.program_label, pp.promise_text, pp.season_year,
  pl.id as production_lot_id, pl.stable_key as production_lot_key, pl.lot_label, pl.succession_number, pl.crop_profile_id,
  cp.crop_label, cp.variety, pl.planned_input_quantity, pl.planned_input_unit, pl.current_quantity, pl.current_unit,
  pl.current_stage, pl.lifecycle_status, pl.planned_sow_date, pl.expected_transplant_start, pl.expected_transplant_end,
  pl.expected_harvest_start, pl.expected_harvest_end,
  coalesce(seed_source.allocated_seed_quantity,0) as allocated_seed_quantity,
  coalesce(seed_source.seed_sources,'[]'::jsonb) as seed_sources,
  coalesce(task_links.task_links,'[]'::jsonb) as task_links,
  coalesce(cycle_links.crop_cycles,'[]'::jsonb) as crop_cycles,
  coalesce(event_links.events,'[]'::jsonb) as events,
  pl.metadata
from atlas.production_lots pl join atlas.production_programs pp on pp.id = pl.program_id
left join atlas.crop_profiles cp on cp.id = pl.crop_profile_id
left join lateral (
  select sum(a.allocated_quantity) filter (where a.allocation_status in ('reserved','consumed')) as allocated_seed_quantity,
    jsonb_agg(jsonb_build_object('seed_lot_id',sl.id,'seed_lot_key',sl.stable_key,'lot_label',sl.lot_label,'supplier',sl.supplier,'allocated_quantity',a.allocated_quantity,'unit',a.unit,'allocation_status',a.allocation_status,'purchase_cost',sl.purchase_cost,'currency',sl.currency) order by sl.stable_key) as seed_sources
  from atlas.seed_lot_allocations a join atlas.seed_lots sl on sl.id=a.seed_lot_id where a.production_lot_id=pl.id
) seed_source on true
left join lateral (
  select jsonb_agg(jsonb_build_object('task_id',t.id,'task_key',t.metadata->>'task_key','title',t.title,'status',t.status,'due_date',t.due_date,'link_role',plt.link_role) order by t.due_date nulls last,t.title) as task_links
  from atlas.production_lot_tasks plt join atlas.tasks t on t.id=plt.task_id where plt.production_lot_id=pl.id
) task_links on true
left join lateral (
  select jsonb_agg(jsonb_build_object('crop_cycle_id',cc.id,'crop_cycle_key',cc.crop_cycle_key,'cycle_state',cc.cycle_state,'lifecycle_status',cc.lifecycle_status,'relation_role',plc.relation_role,'confidence',plc.confidence) order by cc.created_at) as crop_cycles
  from atlas.production_lot_crop_cycles plc join atlas.crop_cycles cc on cc.id=plc.crop_cycle_id where plc.production_lot_id=pl.id
) cycle_links on true
left join lateral (
  select jsonb_agg(jsonb_build_object('event_id',e.id,'event_type',e.event_type,'event_date',e.event_date,'quantity',e.quantity,'unit',e.unit,'source',e.source) order by e.event_date,e.created_at) as events
  from atlas.production_lot_events e where e.production_lot_id=pl.id
) event_links on true;

create view atlas.production_program_summary_v1 as
select pp.id as program_id, pp.farm_id, pp.stable_key, pp.program_label, pp.season_year, pp.status,
  count(pl.id) as production_lot_count,
  count(pl.id) filter (where pl.planned_input_quantity is null) as lots_with_unknown_seed_demand,
  coalesce(sum(pl.planned_input_quantity),0) as known_planned_seed_demand,
  coalesce(sum(inv.allocated_seed_quantity),0) as allocated_seed_quantity,
  count(pl.id) filter (where coalesce(inv.allocated_seed_quantity,0) < coalesce(pl.planned_input_quantity,0)) as lots_with_seed_gap,
  count(pl.id) filter (where tasks.task_count = 0) as lots_without_task_link,
  count(pl.id) filter (where cycles.cycle_count = 0) as lots_without_crop_cycle_link
from atlas.production_programs pp
left join atlas.production_lots pl on pl.program_id=pp.id
left join lateral (select coalesce(sum(a.allocated_quantity) filter (where a.allocation_status in ('reserved','consumed')),0) as allocated_seed_quantity from atlas.seed_lot_allocations a where a.production_lot_id=pl.id) inv on true
left join lateral (select count(*) as task_count from atlas.production_lot_tasks plt where plt.production_lot_id=pl.id) tasks on true
left join lateral (select count(*) as cycle_count from atlas.production_lot_crop_cycles plc where plc.production_lot_id=pl.id) cycles on true
group by pp.id;

alter table atlas.production_programs enable row level security;
alter table atlas.seed_lots enable row level security;
alter table atlas.production_lots enable row level security;
alter table atlas.seed_lot_allocations enable row level security;
alter table atlas.production_lot_tasks enable row level security;
alter table atlas.production_lot_crop_cycles enable row level security;
alter table atlas.production_lot_events enable row level security;

revoke all on atlas.production_programs, atlas.seed_lots, atlas.production_lots, atlas.seed_lot_allocations, atlas.production_lot_tasks, atlas.production_lot_crop_cycles, atlas.production_lot_events from anon, authenticated;
revoke all on atlas.seed_lot_inventory_v1, atlas.production_lot_lineage_v1, atlas.production_program_summary_v1 from anon, authenticated;
grant select, insert, update, delete on atlas.production_programs, atlas.seed_lots, atlas.production_lots, atlas.seed_lot_allocations, atlas.production_lot_tasks, atlas.production_lot_crop_cycles to service_role;
grant select, insert on atlas.production_lot_events to service_role;
grant select on atlas.seed_lot_inventory_v1, atlas.production_lot_lineage_v1, atlas.production_program_summary_v1 to service_role;
revoke execute on function atlas.validate_seed_lot_allocation_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_production_lot_task_link_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_production_lot_cycle_link_v1() from public, anon, authenticated;
revoke execute on function atlas.validate_production_lot_event_v1() from public, anon, authenticated;
revoke execute on function atlas.prevent_production_lot_event_mutation_v1() from public, anon, authenticated;