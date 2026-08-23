alter table atlas.production_tray_batches drop constraint if exists production_tray_batches_status_check;
alter table atlas.production_tray_batches add constraint production_tray_batches_status_check
  check (status in ('germination_pending','germinated','seedling_care','transplant_ready','failed','transplanted','closed'));

create table atlas.production_readiness_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete cascade,
  task_id uuid not null references atlas.tasks(id) on delete restrict,
  observation_outcome text not null check (observation_outcome in ('not_ready','ready','failed')),
  observed_date date not null,
  surviving_seedlings numeric check (surviving_seedlings is null or surviving_seedlings >= 0),
  tray_count numeric check (tray_count is null or tray_count >= 0),
  confidence text not null default 'counted' check (confidence in ('counted','observed','estimated')),
  note text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key)
);

create table atlas.production_transplant_gates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete cascade,
  readiness_observation_id uuid not null references atlas.production_readiness_observations(id) on delete restrict,
  bed_requirement_id uuid references atlas.production_capacity_requirements(id) on delete restrict,
  transplant_task_id uuid references atlas.tasks(id) on delete set null,
  required_bed_feet numeric,
  assigned_bed_feet numeric not null default 0,
  prepared_bed_feet numeric not null default 0,
  gate_status text not null check (gate_status in ('waiting_bed_math','waiting_bed_assignment','waiting_bed_preparation','ready','transplanted','cancelled')),
  blocker_text text,
  ready_at timestamptz,
  refresh_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id,tray_batch_id)
);

create table atlas.production_transplant_placements (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  tray_batch_id uuid not null references atlas.production_tray_batches(id) on delete restrict,
  transplant_gate_id uuid not null references atlas.production_transplant_gates(id) on delete restrict,
  source_task_id uuid not null references atlas.tasks(id) on delete restrict,
  bed_assignment_id uuid not null references atlas.production_bed_assignments(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  planting_claim_id uuid not null references atlas.planting_claims(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  plants_transplanted numeric not null check (plants_transplanted > 0),
  planted_date date not null,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key)
);

create index production_readiness_observations_batch_idx on atlas.production_readiness_observations(tray_batch_id,observed_date desc);
create index production_transplant_gates_status_idx on atlas.production_transplant_gates(farm_id,gate_status);
create index production_transplant_placements_lot_idx on atlas.production_transplant_placements(production_lot_id,planted_date);
create trigger production_transplant_gates_set_updated_at before update on atlas.production_transplant_gates for each row execute function atlas.set_updated_at();

create trigger production_readiness_observations_append_only before update or delete on atlas.production_readiness_observations for each row execute function atlas.prevent_production_stage_record_mutation_v1();
create trigger production_transplant_placements_append_only before update or delete on atlas.production_transplant_placements for each row execute function atlas.prevent_production_stage_record_mutation_v1();

create or replace function atlas.validate_production_readiness_observation_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare v_batch atlas.production_tray_batches%rowtype; v_task_lot uuid;
begin
  select * into v_batch from atlas.production_tray_batches where id=new.tray_batch_id;
  select production_lot_id into v_task_lot from atlas.production_lot_tasks where task_id=new.task_id and link_role='transplant_readiness' limit 1;
  if v_batch.id is null or v_batch.farm_id is distinct from new.farm_id or v_batch.production_lot_id is distinct from new.production_lot_id then
    raise exception 'Readiness observation must stay with its tray batch and farm';
  end if;
  if v_task_lot is distinct from new.production_lot_id then raise exception 'Readiness observation requires the linked readiness task'; end if;
  if new.surviving_seedlings is not null and new.surviving_seedlings > coalesce(v_batch.viable_seedlings,v_batch.seeds_sown) then
    raise exception 'Surviving seedling count cannot exceed the viable tray cohort';
  end if;
  if new.observation_outcome='ready' and coalesce(new.surviving_seedlings,0)<=0 then raise exception 'Ready seedlings require a positive counted cohort'; end if;
  if new.observation_outcome='failed' and coalesce(new.surviving_seedlings,0)<>0 then raise exception 'Failed seedling care must record zero survivors'; end if;
  return new;
end; $$;
create trigger production_readiness_observations_validate before insert on atlas.production_readiness_observations for each row execute function atlas.validate_production_readiness_observation_v1();

create or replace function atlas.validate_production_transplant_placement_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare v_assignment atlas.production_bed_assignments%rowtype; v_gate atlas.production_transplant_gates%rowtype; v_claim_farm uuid; v_cycle_farm uuid; v_cycle_object uuid;
begin
  select * into v_assignment from atlas.production_bed_assignments where id=new.bed_assignment_id;
  select * into v_gate from atlas.production_transplant_gates where id=new.transplant_gate_id;
  select farm_id into v_claim_farm from atlas.planting_claims where id=new.planting_claim_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  if v_assignment.id is null or v_assignment.assignment_status<>'assigned' or v_assignment.production_lot_id is distinct from new.production_lot_id or v_assignment.object_id is distinct from new.object_id then
    raise exception 'Transplant placement requires an active bed assignment for this production lot';
  end if;
  if v_gate.id is null or v_gate.production_lot_id is distinct from new.production_lot_id or v_gate.tray_batch_id is distinct from new.tray_batch_id or v_gate.gate_status not in ('ready','transplanted') then
    raise exception 'Transplant placement requires the ready transplant gate';
  end if;
  if v_assignment.farm_id is distinct from new.farm_id or v_gate.farm_id is distinct from new.farm_id or v_claim_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id then
    raise exception 'Transplant placement records must stay inside one farm and bed';
  end if;
  return new;
end; $$;
create trigger production_transplant_placements_validate before insert on atlas.production_transplant_placements for each row execute function atlas.validate_production_transplant_placement_v1();