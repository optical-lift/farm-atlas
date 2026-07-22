create or replace view atlas.production_seedling_to_field_lineage_v1 as
select pl.farm_id,pl.id production_lot_id,pl.stable_key production_lot_key,pl.lot_label,pl.current_stage,pl.current_quantity,pl.current_unit,
  tb.id tray_batch_id,tb.status tray_batch_status,tb.viable_seedlings,tb.current_quantity tray_quantity,
  ro.id latest_readiness_observation_id,ro.observation_outcome readiness_outcome,ro.surviving_seedlings,ro.observed_date readiness_date,
  tg.id transplant_gate_id,tg.gate_status,tg.required_bed_feet,tg.assigned_bed_feet,tg.prepared_bed_feet,tg.blocker_text,tg.transplant_task_id,
  coalesce(tp.plants_transplanted,0) plants_transplanted,coalesce(tp.beds_used,0) beds_used,tp.planting_claim_id
from atlas.production_lots pl
left join lateral (select * from atlas.production_tray_batches where production_lot_id=pl.id order by batch_number desc limit 1) tb on true
left join lateral (select * from atlas.production_readiness_observations where production_lot_id=pl.id order by observed_date desc,created_at desc limit 1) ro on true
left join atlas.production_transplant_gates tg on tg.production_lot_id=pl.id and tg.tray_batch_id=tb.id
left join lateral (select sum(plants_transplanted) plants_transplanted,count(distinct object_id) beds_used,(array_agg(planting_claim_id order by created_at desc))[1] planting_claim_id from atlas.production_transplant_placements where production_lot_id=pl.id) tp on true;

alter table atlas.production_readiness_observations enable row level security;
alter table atlas.production_transplant_gates enable row level security;
alter table atlas.production_transplant_placements enable row level security;
revoke all on atlas.production_readiness_observations,atlas.production_transplant_gates,atlas.production_transplant_placements from public,anon,authenticated;
revoke all on atlas.production_seedling_to_field_lineage_v1 from public,anon,authenticated;
revoke execute on function atlas.record_production_seedling_care_v1(uuid,numeric,numeric,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.record_production_readiness_v1(uuid,text,numeric,numeric,date,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.refresh_production_transplant_gate_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.record_production_transplant_v1(uuid,jsonb,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.refresh_production_transplant_gate_from_prep_task_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_readiness_observation_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_transplant_placement_v1() from public,anon,authenticated;
grant select,insert,update,delete on atlas.production_readiness_observations,atlas.production_transplant_gates,atlas.production_transplant_placements to service_role;
grant select on atlas.production_seedling_to_field_lineage_v1 to service_role;
grant execute on function atlas.record_production_seedling_care_v1(uuid,numeric,numeric,date,text,text) to service_role;
grant execute on function atlas.record_production_readiness_v1(uuid,text,numeric,numeric,date,date,text,text) to service_role;
grant execute on function atlas.refresh_production_transplant_gate_v1(uuid) to service_role;
grant execute on function atlas.record_production_transplant_v1(uuid,jsonb,date,text,text) to service_role;
