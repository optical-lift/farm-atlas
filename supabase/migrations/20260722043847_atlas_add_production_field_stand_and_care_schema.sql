create table atlas.production_field_stands (
  id uuid primary key default gen_random_uuid(), farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  transplant_placement_id uuid not null references atlas.production_transplant_placements(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  plants_transplanted numeric not null check (plants_transplanted > 0),current_plants numeric not null check (current_plants >= 0 and current_plants <= plants_transplanted),
  total_losses numeric not null default 0 check (total_losses >= 0),stand_status text not null default 'establishing' check (stand_status in ('establishing','established','field_care','harvest_watch','declining','failed','cleared')),
  established_date date,last_observed_date date,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
  unique (transplant_placement_id),unique (production_lot_id,object_id,crop_cycle_id)
);
create table if not exists atlas.production_field_observations (
  id uuid primary key default gen_random_uuid(),farm_id uuid not null references atlas.farms(id) on delete cascade,
  production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,task_id uuid not null references atlas.tasks(id) on delete restrict,
  object_id uuid not null references atlas.growing_objects(id) on delete restrict,crop_cycle_id uuid not null references atlas.crop_cycles(id) on delete restrict,
  observation_type text not null check (observation_type in ('establishment','water','weed','pinch','harvest_readiness')),
  outcome text not null check (length(btrim(outcome))>0),observed_date date not null,quantity numeric check (quantity is null or quantity>=0),unit text,note text,
  idempotency_key text not null,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),unique (farm_id,idempotency_key)
);
create table atlas.production_care_policies (
  id uuid primary key default gen_random_uuid(),farm_id uuid not null references atlas.farms(id) on delete cascade,production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  care_kind text not null check (care_kind in ('watering','weeding','pinching','support','fertility','other')),policy_status text not null check (policy_status in ('required','monitor','not_required')),
  required_before_harvest boolean not null default false,due_date date,frequency_days integer check (frequency_days is null or frequency_days > 0),freshness_days integer check (freshness_days is null or freshness_days > 0),
  current_status text not null default 'unknown' check (current_status in ('unknown','due','satisfied','needs_attention','not_required')),
  source_task_id uuid references atlas.tasks(id) on delete set null,last_observation_id uuid references atlas.production_field_observations(id) on delete set null,last_satisfied_at date,next_due_date date,
  metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique (production_lot_id,care_kind),
  check ((policy_status='not_required' and current_status='not_required') or policy_status<>'not_required')
);
create table atlas.production_harvest_readiness_gates (
  id uuid primary key default gen_random_uuid(),farm_id uuid not null references atlas.farms(id) on delete cascade,production_lot_id uuid not null references atlas.production_lots(id) on delete cascade,
  field_plan_task_id uuid references atlas.tasks(id) on delete set null,harvest_readiness_task_id uuid references atlas.tasks(id) on delete set null,harvest_task_id uuid references atlas.tasks(id) on delete set null,
  harvest_watch_start date,harvest_watch_end date,expected_stems_per_plant numeric check (expected_stems_per_plant is null or expected_stems_per_plant > 0),plants_alive numeric not null default 0 check (plants_alive >= 0),
  care_policy_count integer not null default 0 check (care_policy_count >= 0),required_care_count integer not null default 0 check (required_care_count >= 0),satisfied_required_care_count integer not null default 0 check (satisfied_required_care_count >= 0),
  gate_status text not null default 'waiting_establishment' check (gate_status in ('waiting_establishment','waiting_field_plan','waiting_required_care','waiting_biological_readiness','ready','harvest_watch_open','failed','cancelled')),
  blocker_text text,ready_at timestamptz,refresh_version integer not null default 0,metadata jsonb not null default '{}'::jsonb,created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique (production_lot_id)
);
create index production_field_stands_lot_status_idx on atlas.production_field_stands(production_lot_id,stand_status);
create index if not exists production_field_observations_lot_date_idx on atlas.production_field_observations(production_lot_id,observed_date desc,created_at desc);
create index production_care_policies_lot_status_idx on atlas.production_care_policies(production_lot_id,current_status);
create index production_harvest_readiness_gates_status_idx on atlas.production_harvest_readiness_gates(farm_id,gate_status);
create trigger production_field_stands_set_updated_at before update on atlas.production_field_stands for each row execute function atlas.set_updated_at();
create trigger production_care_policies_set_updated_at before update on atlas.production_care_policies for each row execute function atlas.set_updated_at();
create trigger production_harvest_readiness_gates_set_updated_at before update on atlas.production_harvest_readiness_gates for each row execute function atlas.set_updated_at();
create or replace function atlas.validate_production_field_stand_v1() returns trigger language plpgsql set search_path=atlas,public as $$ declare v_placement atlas.production_transplant_placements%rowtype;begin
select * into v_placement from atlas.production_transplant_placements where id=new.transplant_placement_id;
if v_placement.id is null or v_placement.farm_id is distinct from new.farm_id or v_placement.production_lot_id is distinct from new.production_lot_id or v_placement.object_id is distinct from new.object_id or v_placement.crop_cycle_id is distinct from new.crop_cycle_id or v_placement.plants_transplanted is distinct from new.plants_transplanted then raise exception 'Field stand must match its transplant placement';end if;
if new.total_losses is distinct from new.plants_transplanted-new.current_plants then raise exception 'Field stand losses must reconcile to transplanted minus current plants';end if;return new;end;$$;
create trigger production_field_stands_validate before insert or update on atlas.production_field_stands for each row execute function atlas.validate_production_field_stand_v1();
create or replace function atlas.validate_production_field_observation_v1() returns trigger language plpgsql set search_path=atlas,public as $$ declare v_lot_farm uuid;v_object_farm uuid;v_cycle_farm uuid;v_cycle_object uuid;v_task_farm uuid;begin
select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;select farm_id into v_task_farm from atlas.tasks where id=new.task_id;
if v_lot_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id or v_task_farm is distinct from new.farm_id then raise exception 'Field observation records must stay inside one farm, lot, bed, and task';end if;
if not exists(select 1 from atlas.production_lot_crop_cycles where production_lot_id=new.production_lot_id and crop_cycle_id=new.crop_cycle_id and relation_role='field_batch') then raise exception 'Field observations require a production-lot field crop cycle';end if;return new;end;$$;
do $$ begin
if not exists(select 1 from pg_trigger where tgrelid='atlas.production_field_observations'::regclass and tgname='production_field_observations_append_only') then create trigger production_field_observations_append_only before update or delete on atlas.production_field_observations for each row execute function atlas.prevent_production_stage_record_mutation_v1();end if;
if not exists(select 1 from pg_trigger where tgrelid='atlas.production_field_observations'::regclass and tgname='production_field_observations_validate') then create trigger production_field_observations_validate before insert on atlas.production_field_observations for each row execute function atlas.validate_production_field_observation_v1();end if;end$$;
create or replace function atlas.create_field_stand_from_transplant_v1() returns trigger language plpgsql security definer set search_path=pg_catalog,atlas as $$ begin
insert into atlas.production_field_stands(farm_id,production_lot_id,transplant_placement_id,object_id,crop_cycle_id,plants_transplanted,current_plants,total_losses,stand_status,last_observed_date,metadata)
values(new.farm_id,new.production_lot_id,new.id,new.object_id,new.crop_cycle_id,new.plants_transplanted,new.plants_transplanted,0,'establishing',new.planted_date,jsonb_build_object('planting_claim_id',new.planting_claim_id,'bed_assignment_id',new.bed_assignment_id,'source_task_id',new.source_task_id)) on conflict(transplant_placement_id) do nothing;return new;end;$$;
create trigger production_transplant_placements_create_field_stand after insert on atlas.production_transplant_placements for each row execute function atlas.create_field_stand_from_transplant_v1();
insert into atlas.production_field_stands(farm_id,production_lot_id,transplant_placement_id,object_id,crop_cycle_id,plants_transplanted,current_plants,total_losses,stand_status,last_observed_date,metadata)
select p.farm_id,p.production_lot_id,p.id,p.object_id,p.crop_cycle_id,p.plants_transplanted,p.plants_transplanted,0,case when cc.cycle_state in ('established','growing','harvest_watch','harvesting') then 'established' else 'establishing' end,p.planted_date,jsonb_build_object('planting_claim_id',p.planting_claim_id,'bed_assignment_id',p.bed_assignment_id,'source_task_id',p.source_task_id,'backfilled',true)
from atlas.production_transplant_placements p join atlas.crop_cycles cc on cc.id=p.crop_cycle_id on conflict(transplant_placement_id) do nothing;