with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), plan as (
  select pp.* from atlas.production_plans pp join farm f on f.id=pp.farm_id where pp.stable_key='pollenless_sunflowers_2026'
)
insert into atlas.production_programs(
  farm_id,stable_key,season_year,program_label,program_kind,promise_text,intended_uses,status,metadata
)
select
  f.id,'pollenless_sunflowers_2026_program',2026,'Pollenless Sunflowers · 2026','cut_flower_production',
  'Carry the canonical 2026 pollenless sunflower production plan as Production truth without inventing unknown quantities.',
  p.intended_uses,'active',
  jsonb_build_object(
    'source','legacy_production_plan_promotion_v1',
    'sourceProductionPlanKey',p.stable_key,
    'sourceProductionPlanId',p.id,
    'truthBoundary','Promotion preserves existing plan evidence; unknown quantities remain unknown.'
  )
from farm f cross join plan p
on conflict (farm_id,stable_key) do update
set status='active',
    intended_uses=excluded.intended_uses,
    metadata=atlas.production_programs.metadata || excluded.metadata,
    updated_at=now();

with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), program as (
  select pr.* from atlas.production_programs pr join farm f on f.id=pr.farm_id where pr.stable_key='pollenless_sunflowers_2026_program'
), plan as (
  select pp.* from atlas.production_plans pp join farm f on f.id=pp.farm_id where pp.stable_key='pollenless_sunflowers_2026'
), source_cycle as (
  select cc.* from atlas.crop_cycles cc join farm f on f.id=cc.farm_id
  where cc.crop_cycle_key='phase2_6027b8ee36814b589b8a0f19393ab739_e7996cff4961'
)
insert into atlas.production_lots(
  farm_id,program_id,crop_profile_id,production_plan_id,stable_key,lot_label,succession_number,
  planned_input_quantity,planned_input_unit,current_quantity,current_unit,current_stage,lifecycle_status,
  planned_sow_date,actual_sow_date,expected_harvest_start,expected_harvest_end,intended_uses,metadata
)
select
  f.id,pr.id,cc.crop_profile_id,p.id,'pollenless_sunflowers_2026_s5_fr16_procut_orange',
  'Pollenless Sunflowers · 2026 · S5 · FR16 · ProCut Orange',5,
  null,'seeds',null,null,cc.cycle_state,'active',
  cc.sown_date,cc.sown_date,date '2026-09-02',date '2026-09-12',p.intended_uses,
  jsonb_build_object(
    'source','legacy_production_plan_promotion_v1','sourceProductionPlanKey',p.stable_key,
    'sourceSequenceEvidence','S5 FR16-FR17','sourceCropCycleKey',cc.crop_cycle_key,
    'sourceTaskId',cc.source_task_id,'quantityConfidence','unknown',
    'truthBoundary','S5 succession identity is shared, while the FR16 ProCut Orange body remains its own Production lot.'
  )
from farm f cross join program pr cross join plan p cross join source_cycle cc
on conflict (farm_id,stable_key) do update
set program_id=excluded.program_id,crop_profile_id=excluded.crop_profile_id,production_plan_id=excluded.production_plan_id,
    current_stage=excluded.current_stage,lifecycle_status=excluded.lifecycle_status,actual_sow_date=excluded.actual_sow_date,
    expected_harvest_start=excluded.expected_harvest_start,expected_harvest_end=excluded.expected_harvest_end,
    intended_uses=excluded.intended_uses,metadata=atlas.production_lots.metadata || excluded.metadata,updated_at=now();

with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), program as (
  select pr.* from atlas.production_programs pr join farm f on f.id=pr.farm_id where pr.stable_key='pollenless_sunflowers_2026_program'
), plan as (
  select pp.* from atlas.production_plans pp join farm f on f.id=pp.farm_id where pp.stable_key='pollenless_sunflowers_2026'
), source_cycle as (
  select cc.* from atlas.crop_cycles cc join farm f on f.id=cc.farm_id
  where cc.crop_cycle_key='phase2_8bff7406b31c43479bde261f045f0495_9489a9e3e8e1'
)
insert into atlas.production_lots(
  farm_id,program_id,crop_profile_id,production_plan_id,stable_key,lot_label,succession_number,
  planned_input_quantity,planned_input_unit,current_quantity,current_unit,current_stage,lifecycle_status,
  planned_sow_date,actual_sow_date,expected_harvest_start,expected_harvest_end,intended_uses,metadata
)
select
  f.id,pr.id,cc.crop_profile_id,p.id,'pollenless_sunflowers_2026_s5_fr17_procut_horizon',
  'Pollenless Sunflowers · 2026 · S5 · FR17 · ProCut Horizon',5,
  null,'seeds',null,null,cc.cycle_state,'active',
  cc.sown_date,cc.sown_date,date '2026-09-22',date '2026-10-02',p.intended_uses,
  jsonb_build_object(
    'source','legacy_production_plan_promotion_v1','sourceProductionPlanKey',p.stable_key,
    'sourceSequenceEvidence','S5 FR16-FR17','sourceCropCycleKey',cc.crop_cycle_key,
    'sourceTaskId',cc.source_task_id,'quantityConfidence','unknown',
    'truthBoundary','S5 succession identity is shared, while the FR17 ProCut Horizon body remains its own Production lot.'
  )
from farm f cross join program pr cross join plan p cross join source_cycle cc
on conflict (farm_id,stable_key) do update
set program_id=excluded.program_id,crop_profile_id=excluded.crop_profile_id,production_plan_id=excluded.production_plan_id,
    current_stage=excluded.current_stage,lifecycle_status=excluded.lifecycle_status,actual_sow_date=excluded.actual_sow_date,
    expected_harvest_start=excluded.expected_harvest_start,expected_harvest_end=excluded.expected_harvest_end,
    intended_uses=excluded.intended_uses,metadata=atlas.production_lots.metadata || excluded.metadata,updated_at=now();

with farm as (
  select id from atlas.farms where stable_key='elm_farm'
), mappings as (
  select 'pollenless_sunflowers_2026_s5_fr16_procut_orange'::text as lot_key,
         'phase2_6027b8ee36814b589b8a0f19393ab739_e7996cff4961'::text as cycle_key
  union all
  select 'pollenless_sunflowers_2026_s5_fr17_procut_horizon',
         'phase2_8bff7406b31c43479bde261f045f0495_9489a9e3e8e1'
), resolved as (
  select pl.id as production_lot_id,cc.id as crop_cycle_id,pl.stable_key as lot_key,cc.crop_cycle_key,cc.source_task_id,cc.variety
  from mappings m
  join farm f on true
  join atlas.production_lots pl on pl.farm_id=f.id and pl.stable_key=m.lot_key
  join atlas.crop_cycles cc on cc.farm_id=f.id and cc.crop_cycle_key=m.cycle_key
)
insert into atlas.production_lot_crop_cycles(
  production_lot_id,crop_cycle_id,relation_role,confidence,source,metadata
)
select
  r.production_lot_id,r.crop_cycle_id,'primary','confirmed','legacy_production_plan_promotion_v1',
  jsonb_build_object(
    'sourceProductionLotKey',r.lot_key,'sourceCropCycleKey',r.crop_cycle_key,
    'sourceTaskId',r.source_task_id,'variety',r.variety,
    'evidence','Canonical 2026 plan names S5 as FR16-FR17; this crop cycle comes from a completed sowing task carrying that same production plan and matching crop profile.'
  )
from resolved r
on conflict (production_lot_id,crop_cycle_id,relation_role) do update
set confidence='confirmed',source='legacy_production_plan_promotion_v1',metadata=atlas.production_lot_crop_cycles.metadata || excluded.metadata;