drop function if exists atlas.record_production_establishment_v1(uuid,jsonb,date,text,text);
drop function if exists atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text);
drop table if exists atlas.production_harvest_readiness_gates;

alter table atlas.production_field_observations
  add column if not exists field_stand_id uuid references atlas.production_field_stands(id) on delete cascade;

alter table atlas.production_field_care_state
  add column if not exists field_stand_id uuid references atlas.production_field_stands(id) on delete cascade;

update atlas.production_field_care_state cs
set field_stand_id=s.id
from atlas.production_field_stands s
where s.production_lot_id=cs.production_lot_id and s.object_id=cs.object_id and s.crop_cycle_id=cs.crop_cycle_id
  and cs.field_stand_id is null;

alter table atlas.production_field_care_state alter column field_stand_id set not null;
create unique index if not exists production_field_care_state_stand_uidx on atlas.production_field_care_state(field_stand_id);

alter table atlas.production_harvest_rules
  add column if not exists expected_stems_per_plant numeric check (expected_stems_per_plant is null or expected_stems_per_plant > 0);

alter table atlas.production_harvest_gates
  add column if not exists harvest_readiness_task_id uuid references atlas.tasks(id) on delete set null;

alter table atlas.production_harvest_gates drop constraint if exists production_harvest_gates_gate_status_check;
alter table atlas.production_harvest_gates add constraint production_harvest_gates_gate_status_check
  check (gate_status in ('waiting_establishment','waiting_rules','waiting_care','ready_for_watch','harvest_watch','harvest_ready','failed','cancelled'));

alter table atlas.production_field_observations drop constraint if exists production_field_observations_observation_type_check;
alter table atlas.production_field_observations add constraint production_field_observations_observation_type_check
  check (observation_type in ('establishment','water','weed','pinch','support','fertility','harvest_readiness'));

create or replace function atlas.validate_production_field_observation_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_lot_farm uuid;v_object_farm uuid;v_cycle_farm uuid;v_cycle_object uuid;v_task_farm uuid;v_stand atlas.production_field_stands%rowtype;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  select farm_id into v_task_farm from atlas.tasks where id=new.task_id;
  if new.field_stand_id is not null then select * into v_stand from atlas.production_field_stands where id=new.field_stand_id; end if;
  if v_lot_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id or v_task_farm is distinct from new.farm_id then
    raise exception 'Field observation records must stay inside one farm, lot, bed, and task';
  end if;
  if new.field_stand_id is not null and (v_stand.id is null or v_stand.production_lot_id is distinct from new.production_lot_id or v_stand.object_id is distinct from new.object_id or v_stand.crop_cycle_id is distinct from new.crop_cycle_id) then
    raise exception 'Field observation stand must match its production lot, bed, and crop cycle';
  end if;
  if not exists(select 1 from atlas.production_lot_crop_cycles where production_lot_id=new.production_lot_id and crop_cycle_id=new.crop_cycle_id and relation_role='field_batch') then
    raise exception 'Field observations require a production-lot field crop cycle';
  end if;
  return new;
end;$$;

create or replace function atlas.validate_production_field_care_state_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare v_lot_farm uuid;v_object_farm uuid;v_cycle_farm uuid;v_cycle_object uuid;v_stand atlas.production_field_stands%rowtype;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  select * into v_stand from atlas.production_field_stands where id=new.field_stand_id;
  if v_lot_farm is distinct from new.farm_id or v_object_farm is distinct from new.farm_id or v_cycle_farm is distinct from new.farm_id or v_cycle_object is distinct from new.object_id then
    raise exception 'Field care state must stay inside one farm, lot, and bed';
  end if;
  if v_stand.id is null or v_stand.production_lot_id is distinct from new.production_lot_id or v_stand.object_id is distinct from new.object_id or v_stand.crop_cycle_id is distinct from new.crop_cycle_id then
    raise exception 'Field care state requires the matching counted field stand';
  end if;
  if new.plants_alive is not null and new.plants_alive is distinct from v_stand.current_plants then
    raise exception 'Field care living-plant count must match the field stand';
  end if;
  return new;
end;$$;