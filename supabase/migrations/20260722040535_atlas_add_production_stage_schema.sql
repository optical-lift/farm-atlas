create table atlas.production_tray_batches (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  source_task_id uuid not null references atlas.tasks(id) on delete restrict,
  crop_cycle_id uuid references atlas.crop_cycles(id) on delete set null,
  batch_number integer not null check (batch_number > 0),
  batch_label text not null,
  container_kind text not null,
  block_size_in numeric check (block_size_in is null or block_size_in > 0),
  seeds_sown numeric not null check (seeds_sown > 0),
  seed_unit text not null default 'seeds',
  tray_count numeric not null check (tray_count > 0),
  status text not null default 'germination_pending' check (status in ('germination_pending','germinated','failed','closed')),
  sown_date date not null,
  expected_germination_start date,
  expected_germination_end date,
  germinated_date date,
  viable_seedlings numeric check (viable_seedlings is null or viable_seedlings >= 0),
  current_quantity numeric check (current_quantity is null or current_quantity >= 0),
  current_unit text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id, batch_number),
  unique (farm_id, idempotency_key),
  check (expected_germination_end is null or expected_germination_start is null or expected_germination_end >= expected_germination_start)
);

create table atlas.seed_allocation_consumptions (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  seed_lot_allocation_id uuid not null references atlas.seed_lot_allocations(id) on delete restrict,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete cascade,
  source_task_id uuid not null references atlas.tasks(id) on delete restrict,
  quantity_consumed numeric not null check (quantity_consumed > 0),
  unit text not null default 'seeds',
  consumed_date date not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create table atlas.production_stage_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete restrict,
  stage_key text not null,
  observation_outcome text not null check (observation_outcome in ('not_yet','germinated','failed')),
  observed_date date not null,
  observed_quantity numeric check (observed_quantity is null or observed_quantity >= 0),
  unit text,
  confidence text not null default 'observed' check (confidence in ('observed','counted','estimated')),
  note text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id, idempotency_key)
);

create index production_tray_batches_lot_status_idx on atlas.production_tray_batches(production_lot_id,status);
create index seed_allocation_consumptions_allocation_idx on atlas.seed_allocation_consumptions(seed_lot_allocation_id,consumed_date);
create index production_stage_observations_batch_idx on atlas.production_stage_observations(tray_batch_id,observed_date desc);

create trigger production_tray_batches_set_updated_at before update on atlas.production_tray_batches for each row execute function atlas.set_updated_at();

create or replace function atlas.prevent_production_stage_record_mutation_v1()
returns trigger language plpgsql security definer set search_path=atlas,pg_temp as $$
begin
  raise exception 'Production stage records are append-only; write a correcting observation instead';
end; $$;

create trigger seed_allocation_consumptions_append_only before update or delete on atlas.seed_allocation_consumptions for each row execute function atlas.prevent_production_stage_record_mutation_v1();
create trigger production_stage_observations_append_only before update or delete on atlas.production_stage_observations for each row execute function atlas.prevent_production_stage_record_mutation_v1();

create or replace function atlas.validate_production_tray_batch_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_lot_farm uuid;
  v_task_farm uuid;
  v_cycle_farm uuid;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id into v_task_farm from atlas.tasks where id=new.source_task_id;
  if new.crop_cycle_id is not null then select farm_id into v_cycle_farm from atlas.crop_cycles where id=new.crop_cycle_id; end if;
  if v_lot_farm is distinct from new.farm_id or v_task_farm is distinct from new.farm_id or (new.crop_cycle_id is not null and v_cycle_farm is distinct from new.farm_id) then
    raise exception 'Tray batch records must stay inside one farm';
  end if;
  if not exists (
    select 1 from atlas.production_lot_tasks plt
    where plt.production_lot_id=new.production_lot_id and plt.task_id=new.source_task_id and plt.link_role='sowing'
  ) then
    raise exception 'Tray batches require the production lot sowing task';
  end if;
  return new;
end; $$;
create trigger production_tray_batches_validate before insert or update on atlas.production_tray_batches for each row execute function atlas.validate_production_tray_batch_v1();

create or replace function atlas.validate_seed_allocation_consumption_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_allocation_lot uuid;
  v_allocation_unit text;
  v_allocated numeric;
  v_seed_farm uuid;
  v_batch_lot uuid;
  v_batch_farm uuid;
  v_batch_task uuid;
  v_prior numeric;
begin
  select sla.production_lot_id,sla.unit,sla.allocated_quantity,sl.farm_id
    into v_allocation_lot,v_allocation_unit,v_allocated,v_seed_farm
  from atlas.seed_lot_allocations sla join atlas.seed_lots sl on sl.id=sla.seed_lot_id
  where sla.id=new.seed_lot_allocation_id;
  select production_lot_id,farm_id,source_task_id into v_batch_lot,v_batch_farm,v_batch_task
  from atlas.production_tray_batches where id=new.tray_batch_id;
  if v_allocation_lot is distinct from new.production_lot_id or v_batch_lot is distinct from new.production_lot_id then
    raise exception 'Seed consumption must stay with its production lot';
  end if;
  if v_seed_farm is distinct from new.farm_id or v_batch_farm is distinct from new.farm_id then
    raise exception 'Seed consumption records must stay inside one farm';
  end if;
  if v_batch_task is distinct from new.source_task_id then
    raise exception 'Seed consumption must use the tray batch sowing task';
  end if;
  if v_allocation_unit is distinct from new.unit then
    raise exception 'Seed consumption unit must match its allocation';
  end if;
  select coalesce(sum(quantity_consumed),0) into v_prior
  from atlas.seed_allocation_consumptions where seed_lot_allocation_id=new.seed_lot_allocation_id;
  if v_prior + new.quantity_consumed > v_allocated then
    raise exception 'Seed consumption exceeds the reserved allocation';
  end if;
  return new;
end; $$;
create trigger seed_allocation_consumptions_validate before insert on atlas.seed_allocation_consumptions for each row execute function atlas.validate_seed_allocation_consumption_v1();

create or replace function atlas.validate_production_stage_observation_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_batch_farm uuid;
  v_batch_lot uuid;
  v_seeds_sown numeric;
begin
  select farm_id,production_lot_id,seeds_sown into v_batch_farm,v_batch_lot,v_seeds_sown
  from atlas.production_tray_batches where id=new.tray_batch_id;
  if v_batch_farm is distinct from new.farm_id or v_batch_lot is distinct from new.production_lot_id then
    raise exception 'Stage observation must stay with its tray batch and farm';
  end if;
  if not exists (
    select 1 from atlas.production_lot_tasks plt
    where plt.production_lot_id=new.production_lot_id and plt.task_id=new.task_id and plt.link_role='germination_check'
  ) then
    raise exception 'Germination observations require the linked production germination task';
  end if;
  if new.observed_quantity is not null and new.observed_quantity > v_seeds_sown then
    raise exception 'Observed seedlings cannot exceed seeds sown';
  end if;
  return new;
end; $$;
create trigger production_stage_observations_validate before insert on atlas.production_stage_observations for each row execute function atlas.validate_production_stage_observation_v1();