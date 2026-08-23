create or replace view atlas.production_field_to_harvest_readiness_v1 as
select pl.farm_id,pl.id production_lot_id,pl.stable_key production_lot_key,pl.lot_label,pl.current_stage,pl.current_quantity,pl.current_unit,
  coalesce(cs.beds,0) field_beds,coalesce(cs.plants_alive,0) plants_alive,coalesce(cs.needs_water,0) beds_needing_water,
  coalesce(cs.needs_weeding,0) beds_needing_weeding,coalesce(cs.needs_pinching,0) beds_needing_pinching,
  hr.pinch_required,hr.harvest_watch_start,hr.harvest_watch_end,hr.confidence harvest_rule_confidence,
  hg.id harvest_gate_id,hg.gate_status,hg.blocker_text,hg.harvest_task_id,hg.owner_decision_task_id
from atlas.production_lots pl
left join lateral (
  select count(*) beds,sum(plants_alive) plants_alive,count(*) filter(where water_status='needs_water') needs_water,
    count(*) filter(where weed_pressure in ('moderate','heavy')) needs_weeding,count(*) filter(where pinch_status='due') needs_pinching
  from atlas.production_field_care_state where production_lot_id=pl.id
) cs on true
left join atlas.production_harvest_rules hr on hr.production_lot_id=pl.id
left join atlas.production_harvest_gates hg on hg.production_lot_id=pl.id;

alter table atlas.production_field_observations enable row level security;
alter table atlas.production_field_care_state enable row level security;
alter table atlas.production_harvest_rules enable row level security;
alter table atlas.production_harvest_gates enable row level security;
revoke all on atlas.production_field_observations,atlas.production_field_care_state,atlas.production_harvest_rules,atlas.production_harvest_gates from public,anon,authenticated;
revoke all on atlas.production_field_to_harvest_readiness_v1 from public,anon,authenticated;
revoke execute on function atlas.record_production_establishment_v1(uuid,jsonb,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.set_production_harvest_rules_v1(uuid,boolean,date,date,text,text,text) from public,anon,authenticated;
revoke execute on function atlas.refresh_production_harvest_gate_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.validate_production_field_observation_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_field_care_state_v1() from public,anon,authenticated;
revoke execute on function atlas.close_harvest_rule_decision_on_resolution_v1() from public,anon,authenticated;
grant select,insert,update,delete on atlas.production_field_observations,atlas.production_field_care_state,atlas.production_harvest_rules,atlas.production_harvest_gates to service_role;
grant select on atlas.production_field_to_harvest_readiness_v1 to service_role;
grant execute on function atlas.record_production_establishment_v1(uuid,jsonb,date,text,text) to service_role;
grant execute on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) to service_role;
grant execute on function atlas.set_production_harvest_rules_v1(uuid,boolean,date,date,text,text,text) to service_role;
grant execute on function atlas.refresh_production_harvest_gate_v1(uuid) to service_role;