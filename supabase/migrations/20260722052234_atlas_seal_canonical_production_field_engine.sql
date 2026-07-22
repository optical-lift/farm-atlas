create or replace view atlas.production_field_to_harvest_readiness_v1 as
select
  pl.farm_id,
  pl.id production_lot_id,
  pl.stable_key production_lot_key,
  pl.lot_label,
  pl.current_stage,
  pl.current_quantity,
  pl.current_unit,
  coalesce(fs.field_beds,0) field_beds,
  coalesce(fs.plants_alive,0) plants_alive,
  coalesce(cp.required_policies,0) required_care_policies,
  coalesce(cp.satisfied_policies,0) satisfied_care_policies,
  cp.unsatisfied_care,
  hr.pinch_required,
  hr.harvest_watch_start,
  hr.harvest_watch_end,
  hr.confidence harvest_rule_confidence,
  hg.id harvest_gate_id,
  hg.gate_status,
  hg.blocker_text,
  coalesce(hg.harvest_readiness_task_id,hg.harvest_task_id) harvest_readiness_task_id,
  hg.owner_decision_task_id
from atlas.production_lots pl
left join lateral (
  select
    count(*) filter(where stand_status<>'cleared') field_beds,
    sum(current_plants) filter(where stand_status<>'cleared') plants_alive
  from atlas.production_field_stands
  where production_lot_id=pl.id
) fs on true
left join lateral (
  select
    count(*) filter(where required_before_harvest and policy_status<>'not_required') required_policies,
    count(*) filter(where required_before_harvest and current_status in ('satisfied','not_required')) satisfied_policies,
    string_agg(
      case
        when required_before_harvest
          and policy_status<>'not_required'
          and current_status not in ('satisfied','not_required')
        then initcap(care_kind)||' is '||replace(current_status,'_',' ')
      end,
      ' · ' order by care_kind
    ) unsatisfied_care
  from atlas.production_care_policies
  where production_lot_id=pl.id
) cp on true
left join atlas.production_harvest_rules hr on hr.production_lot_id=pl.id
left join atlas.production_harvest_gates hg on hg.production_lot_id=pl.id;

alter table atlas.production_field_stands enable row level security;
alter table atlas.production_care_policies enable row level security;
revoke all on atlas.production_field_stands,atlas.production_care_policies from public,anon,authenticated;
revoke all on atlas.production_field_to_harvest_readiness_v1 from public,anon,authenticated;
revoke execute on function atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) from public,anon,authenticated;
revoke execute on function atlas.set_production_harvest_rules_v1(uuid,boolean,date,date,text,text,text) from public,anon,authenticated;
revoke execute on function atlas.refresh_production_harvest_gate_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.sync_production_care_policies_v1(uuid) from public,anon,authenticated;
revoke execute on function atlas.create_production_field_stand_after_transplant_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_field_stand_v1() from public,anon,authenticated;
revoke execute on function atlas.validate_production_care_policy_v1() from public,anon,authenticated;
revoke execute on function atlas.reconcile_production_field_care_sources_v1() from public,anon,authenticated;
grant select,insert,update,delete on atlas.production_field_stands,atlas.production_care_policies to service_role;
grant select on atlas.production_field_to_harvest_readiness_v1 to service_role;
grant execute on function atlas.record_production_establishment_v1(uuid,jsonb,text,date,date,text,text) to service_role;
grant execute on function atlas.record_production_field_care_v1(uuid,text,jsonb,date,text,text) to service_role;
grant execute on function atlas.set_production_harvest_rules_v1(uuid,boolean,date,date,text,text,text) to service_role;
grant execute on function atlas.refresh_production_harvest_gate_v1(uuid) to service_role;
grant execute on function atlas.sync_production_care_policies_v1(uuid) to service_role;