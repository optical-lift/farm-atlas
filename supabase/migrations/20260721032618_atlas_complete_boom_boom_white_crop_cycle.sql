insert into atlas.crop_cycles (
  farm_id,
  object_id,
  planting_claim_id,
  crop_profile_id,
  crop_cycle_key,
  crop_label,
  variety,
  cycle_state,
  lifecycle_status,
  sown_date,
  planted_date,
  expected_germination_start,
  expected_germination_end,
  expected_harvest_watch_start,
  expected_harvest_watch_end,
  expected_clear_date,
  coverage_kind,
  coverage_amount,
  coverage_unit,
  source_event_id,
  note,
  metadata,
  object_content_id
)
select
  pc.farm_id,
  go.id,
  pc.id,
  pc.crop_profile_id,
  'claim_' || replace(pc.id::text, '-', '') || '_' || replace(go.id::text, '-', ''),
  pc.crop_label,
  pc.variety,
  'planted',
  'active',
  pc.planted_date,
  pc.planted_date,
  pc.expected_germination_start,
  pc.expected_germination_end,
  pc.expected_harvest_watch_start,
  pc.expected_harvest_watch_end,
  pc.expected_clear_date,
  'whole_object',
  pc.amount,
  pc.unit,
  e.id,
  pc.note,
  jsonb_build_object(
    'source', 'atlas_transition_repair',
    'registry_source', 'repaired_planting_claim',
    'registry_confidence', 'confirmed'
  ),
  oc.id
from atlas.planting_claims pc
join atlas.farms f on f.id = pc.farm_id and f.stable_key = 'elm_farm'
join atlas.growing_objects go on go.farm_id = pc.farm_id and go.stable_key = 'fr_7'
join atlas.object_contents oc on oc.planting_claim_id = pc.id and oc.object_id = go.id
left join atlas.object_activity_events e
  on e.object_content_id = oc.id
 and e.source = 'atlas_transition_repair'
where pc.crop_label = 'Dahlia'
  and pc.variety = 'Boom Boom White'
  and pc.planted_date = date '2026-07-07'
  and not exists (
    select 1
    from atlas.crop_cycles cc
    where cc.planting_claim_id = pc.id
      and cc.object_id = go.id
  );

update atlas.object_activity_events e
set crop_cycle_id = cc.id,
    updated_at = now()
from atlas.crop_cycles cc
where e.object_content_id = cc.object_content_id
  and e.source = 'atlas_transition_repair'
  and e.crop_cycle_id is null;
