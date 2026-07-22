create table atlas.production_field_stands (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  transplant_placement_id uuid not null references atlas.production_transplant_placements(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  planting_claim_id uuid not null references atlas.planting_claims(id) on delete restrict,
  planted_date date not null,
  plants_transplanted numeric not null check (plants_transplanted > 0),
  current_plants numeric not null check (current_plants >= 0),
  total_losses numeric not null default 0 check (total_losses >= 0),
  stand_status text not null default 'establishing'
    check (stand_status in ('establishing','established','field_care','harvest_watch','declining','failed','cleared')),
  establishment_status text not null default 'pending'
    check (establishment_status in ('pending','not_yet','established','partial_loss','failed')),
  established_date date,
  last_observed_date date,
  next_observation_date date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id, transplant_placement_id),
  unique (production_lot_id, object_id),
  check (current_plants + total_losses = plants_transplanted),
  check (next_observation_date is null or next_observation_date >= planted_date)
);
create index production_field_stands_lot_status_idx
  on atlas.production_field_stands(production_lot_id, stand_status);
create index production_field_stands_object_idx
  on atlas.production_field_stands(object_id, stand_status);
create trigger production_field_stands_set_updated_at
  before update on atlas.production_field_stands
  for each row execute function atlas.set_updated_at();

create or replace function atlas.validate_production_field_stand_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_placement atlas.production_transplant_placements%rowtype;
  v_object_farm uuid;
  v_cycle_farm uuid;
  v_cycle_object uuid;
  v_claim_farm uuid;
begin
  select * into v_placement
  from atlas.production_transplant_placements
  where id=new.transplant_placement_id;
  select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  select farm_id into v_claim_farm from atlas.planting_claims where id=new.planting_claim_id;

  if v_placement.id is null
     or v_placement.farm_id is distinct from new.farm_id
     or v_placement.production_lot_id is distinct from new.production_lot_id
     or v_placement.object_id is distinct from new.object_id
     or v_placement.crop_cycle_id is distinct from new.crop_cycle_id
     or v_placement.planting_claim_id is distinct from new.planting_claim_id
     or v_placement.plants_transplanted is distinct from new.plants_transplanted
  then
    raise exception 'Field stand must match its recorded transplant placement';
  end if;
  if v_object_farm is distinct from new.farm_id
     or v_cycle_farm is distinct from new.farm_id
     or v_cycle_object is distinct from new.object_id
     or v_claim_farm is distinct from new.farm_id
  then
    raise exception 'Field stand records must stay inside one farm and bed';
  end if;
  return new;
end;
$$;
create trigger production_field_stands_validate
  before insert or update on atlas.production_field_stands
  for each row execute function atlas.validate_production_field_stand_v1();

create or replace function atlas.create_production_field_stand_after_transplant_v1()
returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$
begin
  insert into atlas.production_field_stands(
    farm_id,production_lot_id,transplant_placement_id,object_id,crop_cycle_id,
    planting_claim_id,planted_date,plants_transplanted,current_plants,total_losses,
    stand_status,establishment_status,metadata
  ) values(
    new.farm_id,new.production_lot_id,new.id,new.object_id,new.crop_cycle_id,
    new.planting_claim_id,new.planted_date,new.plants_transplanted,new.plants_transplanted,0,
    'establishing','pending',
    jsonb_build_object(
      'source','production_transplant_placement',
      'tray_batch_id',new.tray_batch_id,
      'transplant_gate_id',new.transplant_gate_id,
      'source_task_id',new.source_task_id
    )
  )
  on conflict(production_lot_id,transplant_placement_id) do update set
    object_id=excluded.object_id,
    crop_cycle_id=excluded.crop_cycle_id,
    planting_claim_id=excluded.planting_claim_id,
    planted_date=excluded.planted_date,
    plants_transplanted=excluded.plants_transplanted,
    metadata=atlas.production_field_stands.metadata||excluded.metadata,
    updated_at=now();
  return new;
end;
$$;
create trigger trg_create_production_field_stand_after_transplant
  after insert on atlas.production_transplant_placements
  for each row execute function atlas.create_production_field_stand_after_transplant_v1();

create table atlas.production_care_policies (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  care_kind text not null
    check (care_kind in ('watering','weeding','pinching','support','fertility')),
  policy_status text not null default 'unknown'
    check (policy_status in ('unknown','required','not_required','monitor')),
  required_before_harvest boolean not null default false,
  current_status text not null default 'unknown'
    check (current_status in ('unknown','not_due','due','needs_attention','satisfied','not_required')),
  due_date date,
  source_task_id uuid references atlas.tasks(id) on delete set null,
  last_observation_id uuid,
  last_satisfied_at date,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id, care_kind)
);
create index production_care_policies_lot_status_idx
  on atlas.production_care_policies(production_lot_id, care_kind, current_status);
create trigger production_care_policies_set_updated_at
  before update on atlas.production_care_policies
  for each row execute function atlas.set_updated_at();

create or replace function atlas.validate_production_care_policy_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_lot_farm uuid;
  v_task_farm uuid;
begin
  select farm_id into v_lot_farm
  from atlas.production_lots
  where id=new.production_lot_id;
  if v_lot_farm is distinct from new.farm_id then
    raise exception 'Care policy must stay with its production lot farm';
  end if;
  if new.source_task_id is not null then
    select farm_id into v_task_farm from atlas.tasks where id=new.source_task_id;
    if v_task_farm is distinct from new.farm_id then
      raise exception 'Care policy source task must belong to the same farm';
    end if;
  end if;
  if new.policy_status='not_required' and new.current_status<>'not_required' then
    new.current_status:='not_required';
  end if;
  return new;
end;
$$;
create trigger production_care_policies_validate
  before insert or update on atlas.production_care_policies
  for each row execute function atlas.validate_production_care_policy_v1();

create table if not exists atlas.production_field_observations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  field_stand_id uuid not null references atlas.production_field_stands(id) on delete cascade,
  task_id uuid references atlas.tasks(id) on delete set null,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  observation_type text not null
    check (observation_type in ('establishment','watering','weeding','pinching','support','fertility','harvest_readiness')),
  outcome text not null,
  observed_date date not null,
  quantity numeric check (quantity is null or quantity >= 0),
  unit text,
  water_status text,
  weed_pressure text,
  pinch_status text,
  support_status text,
  fertility_status text,
  confidence text not null default 'counted'
    check (confidence in ('counted','observed','estimated')),
  next_check_date date,
  note text,
  idempotency_key text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (farm_id,idempotency_key),
  check (next_check_date is null or next_check_date >= observed_date)
);

create table atlas.production_harvest_readiness_gates (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  gate_status text not null default 'waiting_establishment'
    check (gate_status in (
      'waiting_establishment','waiting_care_plan','waiting_care',
      'ready_for_watch','harvest_watch','harvest_ready','failed','cancelled'
    )),
  expected_field_stands integer not null default 0,
  established_field_stands integer not null default 0,
  plants_alive numeric not null default 0,
  ready_field_stands integer not null default 0,
  open_care_policies integer not null default 0,
  unresolved_care_policies integer not null default 0,
  blocker_text text,
  harvest_readiness_task_id uuid references atlas.tasks(id) on delete set null,
  owner_decision_task_id uuid references atlas.tasks(id) on delete set null,
  ready_at timestamptz,
  refresh_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (production_lot_id)
);
create index production_harvest_readiness_gates_status_idx
  on atlas.production_harvest_readiness_gates(farm_id,gate_status);
create trigger production_harvest_readiness_gates_set_updated_at
  before update on atlas.production_harvest_readiness_gates
  for each row execute function atlas.set_updated_at();