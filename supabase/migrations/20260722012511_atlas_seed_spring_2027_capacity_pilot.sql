with f as (
  select id as farm_id from atlas.farms where stable_key = 'elm_farm'
), src as (
  select f.farm_id, r.id as resource_id, null::uuid as object_id, 'grow_room_tray_inventory'::text as stable_key,
         'Grow Room Cafeteria Tray Inventory'::text as label, 'tray_inventory'::text as capacity_kind,
         r.quantity as total_capacity, 'trays'::text as unit, 'confirmed'::text as capacity_status,
         jsonb_build_object('resource_stable_key',r.stable_key,'resource_status',r.status) as metadata
  from f join atlas.resources r on r.farm_id=f.farm_id and r.stable_key='cafeteria_trays'
  union all
  select f.farm_id, r.id, null::uuid, 'grow_room_shelf_positions','Grow Room Shelf Positions','shelf_positions',
         nullif(r.metadata->>'total_shelf_positions','')::numeric,'shelf_positions','confirmed',
         jsonb_build_object('resource_stable_key',r.stable_key,'rack_count',r.quantity,'shelves_per_rack',r.metadata->'shelves_per_rack')
  from f join atlas.resources r on r.farm_id=f.farm_id and r.stable_key='metal_rack_shelving_units'
  union all
  select f.farm_id, null::uuid, null::uuid, 'grow_room_lit_shelf_positions','Grow Room Lit Shelf Positions','lit_shelf_positions',
         null::numeric,'shelf_positions','unconfirmed',jsonb_build_object('reason','Functional light count and coverage per set are not yet measured')
  from f
  union all
  select f.farm_id, null::uuid, go.id, 'field_row_9_bed_feet','Field Row 9 Bed Feet','bed_feet',
         go.length_ft,'bed_ft','confirmed',jsonb_build_object('object_stable_key',go.stable_key,'width_ft',go.width_ft)
  from f join atlas.growing_objects go on go.farm_id=f.farm_id and go.stable_key='fr_9'
  union all
  select f.farm_id, null::uuid, go.id, 'field_row_10_bed_feet','Field Row 10 Bed Feet','bed_feet',
         go.length_ft,'bed_ft','confirmed',jsonb_build_object('object_stable_key',go.stable_key,'width_ft',go.width_ft)
  from f join atlas.growing_objects go on go.farm_id=f.farm_id and go.stable_key='fr_10'
)
insert into atlas.capacity_pools (farm_id,resource_id,object_id,stable_key,label,capacity_kind,total_capacity,unit,capacity_status,source,metadata)
select farm_id,resource_id,object_id,stable_key,label,capacity_kind,total_capacity,unit,capacity_status,'spring_2027_capacity_pilot',metadata from src;

with f as (select id as farm_id from atlas.farms where stable_key='elm_farm'),
     p as (select id as program_id from atlas.production_programs where stable_key='spring_2027_snapdragon_program')
insert into atlas.capacity_questions (farm_id,production_program_id,stable_key,question_kind,question_text,status,metadata)
select f.farm_id,p.program_id,v.stable_key,v.question_kind,v.question_text,'open',jsonb_build_object('phase','production_spine_phase2')
from f cross join p cross join (values
 ('rocket_s1_seed_quantity','planning_assumption','How many Rocket seeds are planned for Spring 2027 Succession 1?'),
 ('madame_s2_seed_quantity','planning_assumption','How many Madame Butterfly seeds are planned for Spring 2027 Succession 2?'),
 ('snapdragon_seeds_per_three_quarter_block','conversion','How many snapdragon seeds will Elm sow in each 3/4-inch soil block?'),
 ('three_quarter_blocks_per_cafeteria_tray','conversion','How many 3/4-inch soil blocks fit on one cafeteria tray in the actual Elm setup?'),
 ('cafeteria_trays_per_rack_shelf','conversion','How many cafeteria trays fit safely on one rack shelf?'),
 ('functional_grow_light_sets','inventory_count','How many grow-light sets are physically present and functional?'),
 ('shelf_positions_per_grow_light_set','conversion','How many rack shelf positions does one grow-light set fully cover?'),
 ('snapdragon_lit_shelf_occupancy_days','duration','How many planning days should one spring snapdragon tray reserve lit shelf space before leaving the grow room?'),
 ('snapdragon_planning_viability_percent','planning_assumption','What viable-seedling percentage should Atlas use for pre-germination spring snapdragon bed planning?'),
 ('snapdragon_rows_per_three_foot_bed','planning_assumption','How many snapdragon rows will Elm plant in a 3-foot bed?'),
 ('snapdragon_in_row_spacing_inches','planning_assumption','What in-row spacing in inches will Elm use for spring snapdragons?'),
 ('snapdragon_bed_preparation_lead_days','lead_time','How many days before transplanting must the assigned bed be fully weeded and prepared?'),
 ('spring_snapdragon_bed_assignments','placement','Which bed or bed segments are assigned to each Spring 2027 snapdragon succession?')
) as v(stable_key,question_kind,question_text);

with p as (select id from atlas.production_programs where stable_key='spring_2027_snapdragon_program'),
     lots as (select pl.* from atlas.production_lots pl join p on p.id=pl.program_id),
     reqs as (
       select lots.*, x.stable_key as req_key, x.stage_key, x.capacity_kind, x.unit
       from lots cross join (values
         ('seed_inventory','planned','seed','seeds'),
         ('soil_blocks','seed_starting','soil_blocks','blocks'),
         ('tray_positions','seed_starting','trays','trays'),
         ('rack_shelf_positions','seedling_care','shelf_positions','shelf_positions'),
         ('lit_shelf_positions','seedling_care','lit_shelf_positions','shelf_positions'),
         ('field_bed_feet','transplant','bed_feet','bed_ft')
       ) as x(stable_key,stage_key,capacity_kind,unit)
     )
insert into atlas.production_capacity_requirements
  (farm_id,production_lot_id,stable_key,stage_key,capacity_kind,quantity_needed,unit,required_by_date,window_start,window_end,preparation_due_date,calculation_status,source,metadata)
select farm_id,id,req_key,stage_key,capacity_kind,
       case when capacity_kind='seed' then planned_input_quantity else null end,
       unit,
       case when capacity_kind='bed_feet' then expected_transplant_start else planned_sow_date end,
       case when capacity_kind in ('trays','shelf_positions','lit_shelf_positions') then planned_sow_date
            when capacity_kind='bed_feet' then expected_transplant_start else null end,
       null,null,
       case when capacity_kind='seed' and planned_input_quantity is not null then 'confirmed' else 'blocked' end,
       'spring_2027_capacity_pilot',
       jsonb_build_object('production_lot_key',stable_key,'quantity_truth',case when planned_input_quantity is null then 'unknown' else 'known' end)
from reqs;

insert into atlas.capacity_requirement_questions (requirement_id,question_id,blocker_role)
select distinct r.id,q.id,
  case when q.stable_key='spring_snapdragon_bed_assignments' then 'reservation_input' else 'calculation_input' end
from atlas.production_capacity_requirements r
join atlas.production_lots pl on pl.id=r.production_lot_id
join atlas.production_programs pp on pp.id=pl.program_id and pp.stable_key='spring_2027_snapdragon_program'
join atlas.capacity_questions q on q.production_program_id=pp.id
where
  (pl.stable_key='snapdragon_rocket_spring_2027_s1' and q.stable_key='rocket_s1_seed_quantity')
  or (pl.stable_key='snapdragon_madame_butterfly_spring_2027_s2' and q.stable_key='madame_s2_seed_quantity')
  or (r.capacity_kind in ('soil_blocks','trays','shelf_positions','lit_shelf_positions') and q.stable_key='snapdragon_seeds_per_three_quarter_block')
  or (r.capacity_kind in ('trays','shelf_positions','lit_shelf_positions') and q.stable_key='three_quarter_blocks_per_cafeteria_tray')
  or (r.capacity_kind in ('shelf_positions','lit_shelf_positions') and q.stable_key='cafeteria_trays_per_rack_shelf')
  or (r.capacity_kind in ('shelf_positions','lit_shelf_positions') and q.stable_key='snapdragon_lit_shelf_occupancy_days')
  or (r.capacity_kind='lit_shelf_positions' and q.stable_key in ('functional_grow_light_sets','shelf_positions_per_grow_light_set'))
  or (r.capacity_kind='bed_feet' and q.stable_key in ('snapdragon_planning_viability_percent','snapdragon_rows_per_three_foot_bed','snapdragon_in_row_spacing_inches','snapdragon_bed_preparation_lead_days','spring_snapdragon_bed_assignments'));