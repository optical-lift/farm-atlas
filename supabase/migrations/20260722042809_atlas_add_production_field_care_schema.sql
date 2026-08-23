create table atlas.production_field_observations (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade, task_id uuid not null references atlas.tasks(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict, crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  observation_type text not null check (observation_type in ('establishment','water','weed','pinch','harvest_readiness')),
  outcome text not null check (length(btrim(outcome)) > 0), observed_date date not null, quantity numeric check (quantity is null or quantity >= 0), unit text, note text,
  idempotency_key text not null, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), unique (farm_id,idempotency_key)
);
create table atlas.production_field_care_state (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade, object_id uuid not null references atlas.growing_objects(id) on delete restrict,
  crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict, plants_alive numeric check (plants_alive is null or plants_alive >= 0),
  establishment_status text not null default 'unknown' check (establishment_status in ('unknown','establishing','established','failed')),
  water_status text not null default 'unknown' check (water_status in ('unknown','adequate','needs_water')),
  weed_pressure text not null default 'unknown' check (weed_pressure in ('unknown','clear','light','moderate','heavy')),
  pinch_status text not null default 'unknown' check (pinch_status in ('unknown','not_required','due','done')),
  last_establishment_check date,last_watered_at date,last_weeded_at date,last_pinched_at date,metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique (production_lot_id,object_id)
);
create table atlas.production_harvest_rules (
  id uuid primary key default gen_random_uuid(),farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,pinch_required boolean,harvest_watch_start date,harvest_watch_end date,
  confidence text not null default 'confirmed' check (confidence in ('confirmed','estimated')),source text not null default 'owner_decision',idempotency_key text,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(production_lot_id),unique(farm_id,idempotency_key),
  check(harvest_watch_end is null or harvest_watch_start is null or harvest_watch_end>=harvest_watch_start)
);
create table atlas.production_harvest_gates (
  id uuid primary key default gen_random_uuid(),farm_id uuid not null references atlas.farms(id) on delete cascade,production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  gate_status text not null check(gate_status in ('waiting_establishment','waiting_rules','waiting_care','ready_for_watch','harvest_watch','failed','cancelled')),
  blocker_text text,harvest_task_id uuid references atlas.tasks(id) on delete set null,owner_decision_task_id uuid references atlas.tasks(id) on delete set null,
  established_beds integer not null default 0,expected_beds integer not null default 0,plants_alive numeric,ready_at timestamptz,refresh_version integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(production_lot_id)
);
create index production_field_observations_lot_date_idx on atlas.production_field_observations(production_lot_id,observed_date desc);
create index production_field_care_state_attention_idx on atlas.production_field_care_state(farm_id,water_status,weed_pressure,pinch_status);
create index production_harvest_gates_status_idx on atlas.production_harvest_gates(farm_id,gate_status);
create trigger production_field_care_state_set_updated_at before update on atlas.production_field_care_state for each row execute function atlas.set_updated_at();
create trigger production_harvest_rules_set_updated_at before update on atlas.production_harvest_rules for each row execute function atlas.set_updated_at();
create trigger production_harvest_gates_set_updated_at before update on atlas.production_harvest_gates for each row execute function atlas.set_updated_at();
create trigger production_field_observations_append_only before update or delete on atlas.production_field_observations for each row execute function atlas.prevent_production_stage_record_mutation_v1();
create or replace function atlas.validate_production_field_observation_v1() returns trigger language plpgsql set search_path=atlas,public as $$
declare v_lot_farm uuid;v_object_farm uuid;v_cycle_farm uuid;v_cycle_object uuid;begin
select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
if v_lot_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id then raise exception 'Field observation records must stay inside one farm, lot, and bed';end if;
if not exists(select 1 from atlas.production_lot_crop_cycles where production_lot_id=new.production_lot_id and crop_cycle_id=new.crop_cycle_id and relation_role='field_batch') then raise exception 'Field observations require a production-lot field crop cycle';end if;return new;end;$$;
create trigger production_field_observations_validate before insert on atlas.production_field_observations for each row execute function atlas.validate_production_field_observation_v1();
create or replace function atlas.validate_production_field_care_state_v1() returns trigger language plpgsql set search_path=atlas,public as $$
declare v_lot_farm uuid;v_object_farm uuid;v_cycle_farm uuid;v_cycle_object uuid;begin
select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
if v_lot_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id then raise exception 'Field care state must stay inside one farm, lot, and bed';end if;return new;end;$$;
create trigger production_field_care_state_validate before insert or update on atlas.production_field_care_state for each row execute function atlas.validate_production_field_care_state_v1();