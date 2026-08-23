with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
)
insert into atlas.production_programs (
  farm_id, stable_key, season_year, program_label, program_kind, promise_text, intended_uses, status, metadata
)
select
  elm.id,
  'spring_2027_snapdragon_program',
  2027,
  'Spring 2027 Snapdragon Program',
  'cut_flower_production',
  'Produce four traceable spring snapdragon successions whose seed demand, crop cohorts, field output, and eventual value can be reconciled without losing lineage.',
  array['cut_flower','bouquet','florist','business_delivery'],
  'planned',
  jsonb_build_object('pilot',true,'quantity_policy','Unknown seed quantities remain null until physically inventoried.','phase','production_spine_phase_1')
from elm
on conflict (farm_id, stable_key) do update set
  program_label = excluded.program_label,
  promise_text = excluded.promise_text,
  intended_uses = excluded.intended_uses,
  metadata = atlas.production_programs.metadata || excluded.metadata;

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), cp as (
  select id from atlas.crop_profiles where stable_key = 'snapdragon_potomac_ivory_spring_2027'
)
insert into atlas.seed_lots (
  farm_id, crop_profile_id, stable_key, lot_label, crop_label, variety, source_type, supplier,
  received_quantity, quantity_unit, status, metadata
)
select
  elm.id,
  cp.id,
  'johnnys_potomac_ivory_1000_existing_inventory',
  'Johnny''s Potomac Ivory F1 · 1,000 seeds',
  'Snapdragon',
  'Potomac Ivory F1',
  'existing_inventory',
  'Johnny''s Selected Seeds',
  1000,
  'seeds',
  'available',
  jsonb_build_object('count_confidence','confirmed','cost_status','unknown','source','crop_profile_inventory_seed_count','do_not_infer_purchase_date',true)
from elm cross join cp
on conflict (farm_id, stable_key) do update set
  crop_profile_id = excluded.crop_profile_id,
  received_quantity = excluded.received_quantity,
  quantity_unit = excluded.quantity_unit,
  supplier = excluded.supplier,
  metadata = atlas.seed_lots.metadata || excluded.metadata;

with elm as (
  select id from atlas.farms where stable_key = 'elm_farm'
), program as (
  select pp.id, pp.farm_id from atlas.production_programs pp join elm on elm.id=pp.farm_id where pp.stable_key='spring_2027_snapdragon_program'
), lot_source(stable_key, lot_label, succession_number, crop_profile_key, planned_qty, planned_sow, tx_start, tx_end, source_task_key, quantity_confidence) as (
  values
    ('snapdragon_rocket_spring_2027_s1','Rocket Snapdragons · Spring 2027 · Succession 1',1,'snapdragon_rocket_spring_2027',null::numeric,date '2027-01-11',date '2027-03-08',date '2027-03-22','spring_snapdragon_2027_s1_rocket','unknown'),
    ('snapdragon_madame_butterfly_spring_2027_s2','Madame Butterfly Snapdragons · Spring 2027 · Succession 2',2,'snapdragon_madame_butterfly_spring_2027',null::numeric,date '2027-02-01',date '2027-03-29',date '2027-04-12','spring_snapdragon_2027_s2_madame','unknown'),
    ('snapdragon_potomac_ivory_spring_2027_s3','Potomac Ivory Snapdragons · Spring 2027 · Succession 3',3,'snapdragon_potomac_ivory_spring_2027',500::numeric,date '2027-02-22',date '2027-04-19',date '2027-05-03','spring_snapdragon_2027_s3_potomac_ivory','confirmed'),
    ('snapdragon_potomac_ivory_spring_2027_s4','Potomac Ivory Snapdragons · Spring 2027 · Succession 4',4,'snapdragon_potomac_ivory_spring_2027',500::numeric,date '2027-03-15',date '2027-05-10',date '2027-05-24','spring_snapdragon_2027_s4_potomac_ivory','confirmed')
)
insert into atlas.production_lots (
  farm_id, program_id, crop_profile_id, stable_key, lot_label, succession_number,
  planned_input_quantity, planned_input_unit, current_stage, lifecycle_status,
  planned_sow_date, expected_transplant_start, expected_transplant_end, intended_uses, metadata
)
select
  program.farm_id,
  program.id,
  cp.id,
  ls.stable_key,
  ls.lot_label,
  ls.succession_number,
  ls.planned_qty,
  'seeds',
  'planned',
  'planned',
  ls.planned_sow,
  ls.tx_start,
  ls.tx_end,
  array['cut_flower','bouquet','florist','business_delivery'],
  jsonb_build_object('source_task_key',ls.source_task_key,'quantity_confidence',ls.quantity_confidence,'harvest_projection_status','timing_needed','pilot',true)
from lot_source ls
join atlas.crop_profiles cp on cp.stable_key = ls.crop_profile_key
cross join program
on conflict (farm_id, stable_key) do update set
  program_id = excluded.program_id,
  crop_profile_id = excluded.crop_profile_id,
  lot_label = excluded.lot_label,
  succession_number = excluded.succession_number,
  planned_input_quantity = excluded.planned_input_quantity,
  planned_sow_date = excluded.planned_sow_date,
  expected_transplant_start = excluded.expected_transplant_start,
  expected_transplant_end = excluded.expected_transplant_end,
  metadata = atlas.production_lots.metadata || excluded.metadata;

with seed as (
  select id from atlas.seed_lots where stable_key='johnnys_potomac_ivory_1000_existing_inventory' and farm_id=(select id from atlas.farms where stable_key='elm_farm')
), allocations(lot_key, qty, source_task_key) as (
  values
    ('snapdragon_potomac_ivory_spring_2027_s3',500::numeric,'spring_snapdragon_2027_s3_potomac_ivory'),
    ('snapdragon_potomac_ivory_spring_2027_s4',500::numeric,'spring_snapdragon_2027_s4_potomac_ivory')
)
insert into atlas.seed_lot_allocations (seed_lot_id, production_lot_id, allocated_quantity, unit, allocation_status, metadata)
select seed.id, pl.id, a.qty, 'seeds', 'reserved', jsonb_build_object('source_task_key',a.source_task_key,'allocation_basis','confirmed 500-seed task plan')
from allocations a
join atlas.production_lots pl on pl.stable_key=a.lot_key and pl.farm_id=(select id from atlas.farms where stable_key='elm_farm')
cross join seed
on conflict (seed_lot_id, production_lot_id) do update set
  allocated_quantity=excluded.allocated_quantity,
  allocation_status=excluded.allocation_status,
  metadata=atlas.seed_lot_allocations.metadata || excluded.metadata;

with task_map(lot_key, task_key, role) as (
  values
    ('snapdragon_rocket_spring_2027_s1','spring_snapdragon_2027_s1_rocket','sowing'),
    ('snapdragon_madame_butterfly_spring_2027_s2','spring_snapdragon_2027_s2_madame','sowing'),
    ('snapdragon_potomac_ivory_spring_2027_s3','spring_snapdragon_2027_s3_potomac_ivory','sowing'),
    ('snapdragon_potomac_ivory_spring_2027_s4','spring_snapdragon_2027_s4_potomac_ivory','sowing')
)
insert into atlas.production_lot_tasks (production_lot_id, task_id, link_role, source, metadata)
select pl.id, t.id, tm.role, 'phase_1_pilot', jsonb_build_object('task_key',tm.task_key)
from task_map tm
join atlas.production_lots pl on pl.stable_key=tm.lot_key and pl.farm_id=(select id from atlas.farms where stable_key='elm_farm')
join atlas.tasks t on t.farm_id=pl.farm_id and t.metadata->>'task_key'=tm.task_key
on conflict (production_lot_id, task_id, link_role) do nothing;

insert into atlas.production_lot_events (farm_id, production_lot_id, event_type, event_date, quantity, unit, source, idempotency_key, metadata)
select pl.farm_id, pl.id, 'lot_planned', current_date, pl.planned_input_quantity, pl.planned_input_unit, 'phase_1_pilot', 'production-spine:planned:' || pl.stable_key,
       jsonb_build_object('planned_sow_date',pl.planned_sow_date,'succession_number',pl.succession_number)
from atlas.production_lots pl
join atlas.production_programs pp on pp.id=pl.program_id
where pp.stable_key='spring_2027_snapdragon_program'
on conflict (farm_id,idempotency_key) do nothing;

insert into atlas.production_lot_events (farm_id, production_lot_id, event_type, event_date, quantity, unit, source, idempotency_key, metadata)
select pl.farm_id, pl.id, 'seed_allocated', current_date, a.allocated_quantity, a.unit, 'phase_1_pilot', 'production-spine:seed-allocated:' || pl.stable_key,
       jsonb_build_object('seed_lot_id',a.seed_lot_id,'allocation_status',a.allocation_status)
from atlas.seed_lot_allocations a
join atlas.production_lots pl on pl.id=a.production_lot_id
join atlas.production_programs pp on pp.id=pl.program_id
where pp.stable_key='spring_2027_snapdragon_program'
on conflict (farm_id,idempotency_key) do nothing;