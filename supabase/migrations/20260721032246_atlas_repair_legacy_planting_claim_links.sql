with claim_targets as (
  select
    pc.id as planting_claim_id,
    pc.farm_id,
    pc.field_log_id,
    pc.crop_profile_id,
    pc.crop_label,
    pc.variety,
    pc.planted_date,
    pc.planting_method,
    pc.amount,
    pc.unit,
    pc.confidence,
    pc.expected_germination_start,
    pc.expected_germination_end,
    pc.expected_harvest_watch_start,
    pc.expected_harvest_watch_end,
    pc.expected_clear_date,
    pc.note,
    go.id as object_id,
    go.zone_id
  from atlas.planting_claims pc
  join atlas.farms f on f.id = pc.farm_id
  join atlas.growing_objects go
    on go.farm_id = pc.farm_id
   and go.stable_key = case
     when pc.crop_label = 'Dahlia'
      and pc.variety = 'Boom Boom White'
      and pc.planted_date = date '2026-07-07'
       then 'fr_7'
     when pc.crop_label in ('Lettuce', 'Onions', 'Spinach')
      and pc.planted_date = date '2026-07-13'
      and pc.metadata ->> 'zone_label' = 'Lilac Haven'
       then 'lilac_haven_fence_line'
     else null
   end
  where f.stable_key = 'elm_farm'
    and (
      (pc.crop_label = 'Dahlia'
        and pc.variety = 'Boom Boom White'
        and pc.planted_date = date '2026-07-07')
      or
      (pc.crop_label in ('Lettuce', 'Onions', 'Spinach')
        and pc.planted_date = date '2026-07-13'
        and pc.metadata ->> 'zone_label' = 'Lilac Haven')
    )
)
insert into atlas.planting_claim_objects (
  planting_claim_id,
  object_id,
  coverage_kind,
  coverage_amount,
  coverage_unit
)
select planting_claim_id, object_id, 'whole_object', amount, unit
from claim_targets
on conflict on constraint planting_claim_objects_planting_claim_id_object_id_key do nothing;

with claim_targets as (
  select pc.id as planting_claim_id, pc.field_log_id, go.id as object_id, go.zone_id
  from atlas.planting_claims pc
  join atlas.farms f on f.id = pc.farm_id
  join atlas.growing_objects go
    on go.farm_id = pc.farm_id
   and go.stable_key = case
     when pc.crop_label = 'Dahlia' and pc.variety = 'Boom Boom White' and pc.planted_date = date '2026-07-07' then 'fr_7'
     when pc.crop_label in ('Lettuce', 'Onions', 'Spinach') and pc.planted_date = date '2026-07-13' and pc.metadata ->> 'zone_label' = 'Lilac Haven' then 'lilac_haven_fence_line'
     else null
   end
  where f.stable_key = 'elm_farm'
)
insert into atlas.field_log_objects (field_log_id, zone_id, object_id, role)
select distinct field_log_id, zone_id, object_id, 'planted'
from claim_targets t
where field_log_id is not null
  and not exists (
    select 1 from atlas.field_log_objects flo
    where flo.field_log_id = t.field_log_id
      and flo.object_id = t.object_id
      and flo.role = 'planted'
  );

with claim_targets as (
  select
    pc.id as planting_claim_id,
    pc.farm_id,
    pc.crop_profile_id,
    pc.crop_label,
    pc.variety,
    pc.planted_date,
    pc.planting_method,
    pc.amount,
    pc.unit,
    pc.confidence,
    pc.expected_germination_start,
    pc.expected_germination_end,
    pc.expected_harvest_watch_start,
    pc.expected_harvest_watch_end,
    pc.expected_clear_date,
    pc.note,
    go.id as object_id
  from atlas.planting_claims pc
  join atlas.farms f on f.id = pc.farm_id
  join atlas.growing_objects go
    on go.farm_id = pc.farm_id
   and go.stable_key = case
     when pc.crop_label = 'Dahlia' and pc.variety = 'Boom Boom White' and pc.planted_date = date '2026-07-07' then 'fr_7'
     when pc.crop_label in ('Lettuce', 'Onions', 'Spinach') and pc.planted_date = date '2026-07-13' and pc.metadata ->> 'zone_label' = 'Lilac Haven' then 'lilac_haven_fence_line'
     else null
   end
  where f.stable_key = 'elm_farm'
)
insert into atlas.object_contents (
  farm_id,
  object_id,
  planting_claim_id,
  crop_profile_id,
  content_label,
  content_type,
  variety,
  planted_date,
  status,
  confidence,
  expected_germination_start,
  expected_germination_end,
  expected_harvest_watch_start,
  expected_harvest_watch_end,
  expected_clear_date,
  note,
  metadata,
  start_method,
  clear_bed_date
)
select
  farm_id,
  object_id,
  planting_claim_id,
  crop_profile_id,
  crop_label,
  'planting',
  variety,
  planted_date,
  'planted',
  confidence,
  expected_germination_start,
  expected_germination_end,
  expected_harvest_watch_start,
  expected_harvest_watch_end,
  expected_clear_date,
  note,
  jsonb_build_object(
    'source', 'atlas_transition_repair',
    'planting_claim_id', planting_claim_id,
    'coverage_kind', 'whole_object',
    'claim_amount', amount,
    'claim_unit', unit
  ),
  planting_method,
  expected_clear_date
from claim_targets t
where not exists (
  select 1 from atlas.object_contents oc
  where oc.planting_claim_id = t.planting_claim_id
    and oc.object_id = t.object_id
);
