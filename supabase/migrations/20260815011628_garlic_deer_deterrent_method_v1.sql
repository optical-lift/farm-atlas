-- Production history note: this first selector used stable_key='elm'. Elm Farm's
-- canonical stable key is elm_farm, so this migration applied successfully but
-- matched no farm rows. The following production migration corrects the selector.

insert into atlas.resources(
  id,farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,location_label,condition_notes,restock_needed,consumable,borrow_or_owner,metadata,created_at,updated_at
)
select gen_random_uuid(),farm.id,'hdx_1_gallon_pump_sprayer','HDX 1-Gallon Pump Sprayer','equipment','pest_control','available',1,'sprayer',null,
  'Picked up from Home Depot Aug. 14, 2026 and in active use for garlic deer deterrent.',false,false,'owner',
  jsonb_build_object('capacity_gallons',1,'source','owner_instruction_20260814','home_depot_pickup_confirmed',true),now(),now()
from atlas.farms farm
where farm.stable_key='elm'
on conflict (farm_id,stable_key) do update
set label=excluded.label,status='available',quantity=coalesce(atlas.resources.quantity,excluded.quantity),unit=excluded.unit,
    condition_notes=excluded.condition_notes,metadata=coalesce(atlas.resources.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();

insert into atlas.resources(
  id,farm_id,stable_key,label,resource_type,resource_category,status,quantity,unit,location_label,condition_notes,restock_needed,consumable,borrow_or_owner,metadata,created_at,updated_at
)
select gen_random_uuid(),farm.id,'garlic_deer_deterrent_concentrate','Garlic Deer-Deterrent Concentrate','pest_control','pest_control','available',null,'cup',null,
  'Concentrate currently in use at Elm Farm. On-hand quantity has not been measured.',false,true,'owner',
  jsonb_build_object('source','owner_instruction_20260814','quantity_status','unknown_on_hand'),now(),now()
from atlas.farms farm
where farm.stable_key='elm'
on conflict (farm_id,stable_key) do update
set label=excluded.label,status='available',unit=excluded.unit,consumable=true,
    condition_notes=excluded.condition_notes,metadata=coalesce(atlas.resources.metadata,'{}'::jsonb)||excluded.metadata,updated_at=now();

insert into atlas.action_requirement_templates(
  id,farm_id,stable_key,action_type,label,applies_to_task_type,applies_to_planting_method,
  required_resource_categories,optional_resource_categories,required_resource_keys,optional_resource_keys,
  creates_follow_up_task_types,hard_parts,unlocks,notes,metadata,created_at,updated_at
)
select gen_random_uuid(),farm.id,'garlic_deer_deterrent_spray','sprayed','Garlic deer deterrent','deer_deterrent',null,
  array['pest_control']::text[],array[]::text[],array['hdx_1_gallon_pump_sprayer','garlic_deer_deterrent_concentrate']::text[],array[]::text[],array[]::text[],
  jsonb_build_array('Apply in the evening.','Do not apply when rain is forecast the following day.','Coverage includes garden-zone borders, inside each bed, and the sunflower leaves themselves.'),
  jsonb_build_array('Creates a consistent deer-deterrent treatment pass without redefining the method on each task.'),
  'Mix 3/4 cup garlic concentrate with 1 gallon water. Pour concentrate into the pump-sprayer tank first, add the water, then shake well until completely blended. Spray around the border of every garden zone and inside each bed. Coat the actual sunflower leaves themselves.',
  jsonb_build_object(
    'method_version','garlic_deer_deterrent_v1','owner_authored',true,'source','owner_instruction_20260814',
    'mix',jsonb_build_object('garlic_concentrate_cups',0.75,'water_gallons',1,'batch_gallons',1),
    'preparation_steps',jsonb_build_array('Pour 3/4 cup garlic concentrate into the pump-sprayer tank.','Add 1 gallon water.','Shake well to make sure the concentrate and water blend completely.'),
    'timing',jsonb_build_object('daypart','evening','next_day_rain_forecast_required',false),
    'weather_gate',jsonb_build_object('type','next_day_rain_forecast','eligible_when','no_rain_forecast'),
    'coverage_steps',jsonb_build_array('Spray around the border of every garden zone.','Spray inside each bed.','Coat the actual sunflower leaves themselves.'),
    'card_language','3/4 cup concentrate + 1 gallon water. Concentrate first, add water, shake well. Evening only; do not spray if rain is forecast tomorrow. Spray zone borders, inside every bed, and sunflower leaves.'
  ),now(),now()
from atlas.farms farm
where farm.stable_key='elm'
on conflict (farm_id,stable_key) do update
set action_type=excluded.action_type,label=excluded.label,applies_to_task_type=excluded.applies_to_task_type,
    required_resource_categories=excluded.required_resource_categories,required_resource_keys=excluded.required_resource_keys,
    hard_parts=excluded.hard_parts,unlocks=excluded.unlocks,notes=excluded.notes,metadata=excluded.metadata,updated_at=now();