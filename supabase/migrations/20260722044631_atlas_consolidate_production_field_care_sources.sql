-- Consolidate concurrent field-care drafts into one canonical physical source.
-- production_field_stands owns living-plant counts; production_field_care_state
-- is the current water/weed/pinch projection for that stand.

alter table atlas.production_field_observations
  add column if not exists field_stand_id uuid references atlas.production_field_stands(id) on delete cascade;
alter table atlas.production_field_care_state
  add column if not exists field_stand_id uuid references atlas.production_field_stands(id) on delete cascade;

insert into atlas.production_field_stands(
  farm_id,production_lot_id,transplant_placement_id,object_id,crop_cycle_id,
  planting_claim_id,planted_date,plants_transplanted,current_plants,total_losses,
  stand_status,establishment_status,metadata
)
select
  tp.farm_id,tp.production_lot_id,tp.id,tp.object_id,tp.crop_cycle_id,
  tp.planting_claim_id,tp.planted_date,tp.plants_transplanted,tp.plants_transplanted,0,
  'establishing','pending',jsonb_build_object('source','production_transplant_placement_backfill')
from atlas.production_transplant_placements tp
on conflict(production_lot_id,transplant_placement_id) do nothing;

update atlas.production_field_care_state cs
set field_stand_id=fs.id,
    plants_alive=fs.current_plants,
    updated_at=now()
from atlas.production_field_stands fs
where fs.production_lot_id=cs.production_lot_id
  and fs.object_id=cs.object_id
  and cs.field_stand_id is null;

update atlas.production_field_observations fo
set field_stand_id=fs.id
from atlas.production_field_stands fs
where fs.production_lot_id=fo.production_lot_id
  and fs.object_id=fo.object_id
  and fs.crop_cycle_id=fo.crop_cycle_id
  and fo.field_stand_id is null;

alter table atlas.production_harvest_rules
  add column if not exists expected_stems_per_plant numeric
  check (expected_stems_per_plant is null or expected_stems_per_plant >= 0);

alter table atlas.production_harvest_gates
  add column if not exists harvest_readiness_task_id uuid references atlas.tasks(id) on delete set null,
  add column if not exists ready_field_stands integer not null default 0,
  add column if not exists open_care_policies integer not null default 0,
  add column if not exists unresolved_care_policies integer not null default 0;

alter table atlas.production_harvest_gates
  drop constraint if exists production_harvest_gates_gate_status_check;
alter table atlas.production_harvest_gates
  add constraint production_harvest_gates_gate_status_check
  check (gate_status in (
    'waiting_establishment','waiting_care_plan','waiting_rules','waiting_care',
    'ready_for_watch','harvest_watch','harvest_ready','failed','cancelled'
  ));

-- The alternate gate table was never authoritative and contained no rows.
drop table if exists atlas.production_harvest_readiness_gates cascade;

-- Remove both competing establishment-command overloads before the canonical
-- command is introduced by the later migration.
drop function if exists atlas.record_production_establishment_v1(uuid,jsonb,date,text,text);
drop function if exists atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text);

create or replace function atlas.reconcile_production_field_care_sources_v1()
returns jsonb language plpgsql security definer set search_path=pg_catalog,atlas as $$
declare
  v_stands integer:=0;
  v_states integer:=0;
  v_observations integer:=0;
begin
  insert into atlas.production_field_stands(
    farm_id,production_lot_id,transplant_placement_id,object_id,crop_cycle_id,
    planting_claim_id,planted_date,plants_transplanted,current_plants,total_losses,
    stand_status,establishment_status,metadata
  )
  select
    tp.farm_id,tp.production_lot_id,tp.id,tp.object_id,tp.crop_cycle_id,
    tp.planting_claim_id,tp.planted_date,tp.plants_transplanted,tp.plants_transplanted,0,
    'establishing','pending',jsonb_build_object('source','production_transplant_placement_reconcile')
  from atlas.production_transplant_placements tp
  on conflict(production_lot_id,transplant_placement_id) do nothing;
  get diagnostics v_stands=row_count;

  update atlas.production_field_care_state cs
  set field_stand_id=fs.id,
      plants_alive=fs.current_plants,
      updated_at=now()
  from atlas.production_field_stands fs
  where fs.production_lot_id=cs.production_lot_id
    and fs.object_id=cs.object_id
    and (cs.field_stand_id is distinct from fs.id or cs.plants_alive is distinct from fs.current_plants);
  get diagnostics v_states=row_count;

  update atlas.production_field_observations fo
  set field_stand_id=fs.id
  from atlas.production_field_stands fs
  where fs.production_lot_id=fo.production_lot_id
    and fs.object_id=fo.object_id
    and fs.crop_cycle_id=fo.crop_cycle_id
    and fo.field_stand_id is null;
  get diagnostics v_observations=row_count;

  return jsonb_build_object(
    'fieldStandsCreated',v_stands,
    'careStatesReconciled',v_states,
    'observationsLinked',v_observations
  );
end; $$;

create or replace function atlas.validate_production_field_observation_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_lot_farm uuid;
  v_object_farm uuid;
  v_cycle_farm uuid;
  v_cycle_object uuid;
  v_stand atlas.production_field_stands%rowtype;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  if new.field_stand_id is not null then
    select * into v_stand from atlas.production_field_stands where id=new.field_stand_id;
  end if;
  if v_lot_farm is distinct from new.farm_id
     or v_object_farm is distinct from new.farm_id
     or v_cycle_farm is distinct from new.farm_id
     or v_cycle_object is distinct from new.object_id
  then
    raise exception 'Field observation records must stay inside one farm, lot, and bed';
  end if;
  if new.field_stand_id is not null and (
    v_stand.id is null
    or v_stand.farm_id is distinct from new.farm_id
    or v_stand.production_lot_id is distinct from new.production_lot_id
    or v_stand.object_id is distinct from new.object_id
    or v_stand.crop_cycle_id is distinct from new.crop_cycle_id
  ) then
    raise exception 'Field observation must match its production field stand';
  end if;
  if not exists(
    select 1 from atlas.production_lot_crop_cycles
    where production_lot_id=new.production_lot_id
      and crop_cycle_id=new.crop_cycle_id
      and relation_role='field_batch'
  ) then
    raise exception 'Field observations require a production-lot field crop cycle';
  end if;
  return new;
end; $$;

create or replace function atlas.validate_production_field_care_state_v1()
returns trigger language plpgsql set search_path=atlas,public as $$
declare
  v_lot_farm uuid;
  v_object_farm uuid;
  v_cycle_farm uuid;
  v_cycle_object uuid;
  v_stand atlas.production_field_stands%rowtype;
begin
  select farm_id into v_lot_farm from atlas.production_lots where id=new.production_lot_id;
  select farm_id into v_object_farm from atlas.growing_objects where id=new.object_id;
  select farm_id,object_id into v_cycle_farm,v_cycle_object from atlas.crop_cycles where id=new.crop_cycle_id;
  if new.field_stand_id is not null then
    select * into v_stand from atlas.production_field_stands where id=new.field_stand_id;
  end if;
  if v_lot_farm is distinct from new.farm_id
     or v_object_farm is distinct from new.farm_id
     or v_cycle_farm is distinct from new.farm_id
     or v_cycle_object is distinct from new.object_id
  then
    raise exception 'Field care state must stay inside one farm, lot, and bed';
  end if;
  if new.field_stand_id is not null and (
    v_stand.id is null
    or v_stand.farm_id is distinct from new.farm_id
    or v_stand.production_lot_id is distinct from new.production_lot_id
    or v_stand.object_id is distinct from new.object_id
    or v_stand.crop_cycle_id is distinct from new.crop_cycle_id
    or new.plants_alive is distinct from v_stand.current_plants
  ) then
    raise exception 'Field care state must mirror its production field stand count';
  end if;
  return new;
end; $$;

perform atlas.reconcile_production_field_care_sources_v1();