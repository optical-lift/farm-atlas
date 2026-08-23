drop view if exists atlas.production_field_continuity_audit_v1;
drop view atlas.production_field_to_harvest_readiness_v1;

create view atlas.production_field_to_harvest_readiness_v1
with (security_invoker=true)
as
select
  fs.farm_id,
  pp.id as program_id,
  pp.stable_key as program_key,
  pp.program_label,
  pl.id as production_lot_id,
  pl.stable_key as production_lot_key,
  pl.lot_label,
  pl.current_stage as production_lot_stage,
  pl.lifecycle_status as production_lot_status,
  cp.id as crop_profile_id,
  cp.crop_label,
  cp.variety,
  fs.id as field_stand_id,
  fs.transplant_placement_id,
  fs.object_id,
  go.stable_key as object_key,
  go.label as object_label,
  fs.crop_cycle_id,
  cc.cycle_state,
  cc.lifecycle_status as crop_cycle_status,
  fs.plants_transplanted,
  fs.current_plants,
  fs.total_losses,
  fs.stand_status,
  fs.established_date,
  fs.last_observed_date,
  fcs.water_status,
  fcs.weed_pressure,
  fcs.pinch_status,
  fcs.last_watered_at,
  fcs.last_weeded_at,
  fcs.last_pinched_at,
  hr.harvest_watch_start,
  hr.harvest_watch_end,
  hr.expected_stems_per_plant,
  hr.confidence as harvest_rule_confidence,
  coalesce(pa.policy_count,0) as care_policy_count,
  coalesce(pa.required_before_harvest_count,0) as required_before_harvest_count,
  coalesce(pa.unsatisfied_required_count,0) as unsatisfied_required_count,
  coalesce(pa.policies,'{}'::jsonb) as care_policies,
  hg.id as harvest_gate_id,
  hg.gate_status as harvest_gate_status,
  hg.blocker_text as harvest_gate_blocker,
  hg.owner_decision_task_id,
  owner_task.status as owner_decision_task_status,
  hg.harvest_readiness_task_id,
  readiness_task.status as harvest_readiness_task_status,
  hg.harvest_task_id,
  harvest_task.status as harvest_task_status,
  latest_obs.observation_type as latest_observation_type,
  latest_obs.outcome as latest_observation_outcome,
  latest_obs.observed_date as latest_observation_date,
  case when latest_obs.observation_type='harvest_readiness' then latest_obs.quantity end as latest_estimated_marketable_stems,
  case when latest_obs.observation_type='harvest_readiness' then latest_obs.unit end as latest_estimate_unit,
  fs.metadata as field_stand_metadata
from atlas.production_field_stands fs
join atlas.production_lots pl on pl.id=fs.production_lot_id
join atlas.production_programs pp on pp.id=pl.program_id
left join atlas.crop_profiles cp on cp.id=pl.crop_profile_id
join atlas.growing_objects go on go.id=fs.object_id
join atlas.crop_cycles cc on cc.id=fs.crop_cycle_id
left join atlas.production_field_care_state fcs on fcs.field_stand_id=fs.id
left join atlas.production_harvest_rules hr on hr.production_lot_id=pl.id
left join atlas.production_harvest_gates hg on hg.production_lot_id=pl.id
left join atlas.tasks owner_task on owner_task.id=hg.owner_decision_task_id
left join atlas.tasks readiness_task on readiness_task.id=hg.harvest_readiness_task_id
left join atlas.tasks harvest_task on harvest_task.id=hg.harvest_task_id
left join lateral (
  select count(*)::integer as policy_count,
    count(*) filter(where p.required_before_harvest)::integer as required_before_harvest_count,
    count(*) filter(where p.required_before_harvest and p.current_status not in ('satisfied','not_required'))::integer as unsatisfied_required_count,
    jsonb_object_agg(p.care_kind,jsonb_build_object('policyStatus',p.policy_status,'requiredBeforeHarvest',p.required_before_harvest,'currentStatus',p.current_status,'dueDate',p.due_date,'lastSatisfiedAt',p.last_satisfied_at,'nextDueDate',p.next_due_date) order by p.care_kind) as policies
  from atlas.production_care_policies p where p.production_lot_id=pl.id
) pa on true
left join lateral (
  select o.observation_type,o.outcome,o.observed_date,o.quantity,o.unit
  from atlas.production_field_observations o
  where o.field_stand_id=fs.id
  order by o.observed_date desc,o.created_at desc limit 1
) latest_obs on true;

create view atlas.production_field_continuity_audit_v1
with (security_invoker=true)
as
with lot_scope as (
  select distinct production_lot_id from atlas.production_transplant_placements
  union select distinct production_lot_id from atlas.production_field_stands
), placement_counts as (
  select production_lot_id,count(*)::integer placement_count,sum(plants_transplanted) transplanted_plants
  from atlas.production_transplant_placements group by production_lot_id
), stand_counts as (
  select production_lot_id,count(*)::integer stand_count,
    count(*) filter(where stand_status='establishing')::integer establishing_count,
    count(*) filter(where stand_status='failed')::integer failed_count,
    coalesce(sum(current_plants),0) living_plants,coalesce(sum(total_losses),0) total_losses
  from atlas.production_field_stands where stand_status<>'cleared' group by production_lot_id
), care_counts as (
  select production_lot_id,count(*)::integer policy_count,
    count(*) filter(where required_before_harvest)::integer required_policy_count,
    count(*) filter(where required_before_harvest and current_status not in ('satisfied','not_required'))::integer unsatisfied_required_count
  from atlas.production_care_policies group by production_lot_id
), care_state_counts as (
  select production_lot_id,count(*)::integer care_state_count from atlas.production_field_care_state group by production_lot_id
)
select
  pl.farm_id,pp.id program_id,pp.stable_key program_key,pp.program_label,
  pl.id production_lot_id,pl.stable_key production_lot_key,pl.lot_label,pl.current_stage,pl.lifecycle_status,
  coalesce(pc.placement_count,0) transplant_placement_count,coalesce(sc.stand_count,0) field_stand_count,
  greatest(coalesce(pc.placement_count,0)-coalesce(sc.stand_count,0),0) missing_field_stand_count,
  coalesce(sc.establishing_count,0) unresolved_establishment_count,coalesce(sc.failed_count,0) failed_stand_count,
  coalesce(pc.transplanted_plants,0) transplanted_plants,coalesce(sc.living_plants,0) living_plants,coalesce(sc.total_losses,0) total_losses,
  coalesce(csc.care_state_count,0) field_care_state_count,greatest(coalesce(sc.stand_count,0)-coalesce(csc.care_state_count,0),0) missing_field_care_state_count,
  coalesce(ca.policy_count,0) care_policy_count,greatest(5-coalesce(ca.policy_count,0),0) missing_care_policy_count,
  coalesce(ca.required_policy_count,0) required_care_policy_count,coalesce(ca.unsatisfied_required_count,0) unsatisfied_required_care_count,
  (hr.id is not null) has_harvest_rule,hr.harvest_watch_start,hr.harvest_watch_end,hr.expected_stems_per_plant,
  hg.id harvest_gate_id,hg.gate_status harvest_gate_status,hg.blocker_text harvest_gate_blocker,
  hg.owner_decision_task_id,owner_task.status owner_decision_task_status,
  hg.harvest_readiness_task_id,readiness_task.status harvest_readiness_task_status,
  hg.harvest_task_id,harvest_task.status harvest_task_status,
  case
    when coalesce(pc.placement_count,0)>coalesce(sc.stand_count,0) then 'missing_field_stand'
    when coalesce(sc.establishing_count,0)>0 then 'waiting_establishment'
    when coalesce(sc.living_plants,0)=0 then 'field_cohort_failed'
    when coalesce(csc.care_state_count,0)<coalesce(sc.stand_count,0) then 'missing_field_care_state'
    when hr.id is null or hr.harvest_watch_start is null or hr.harvest_watch_end is null or coalesce(ca.policy_count,0)<5 then 'missing_field_plan'
    when coalesce(ca.unsatisfied_required_count,0)>0 then 'required_care_due'
    when hg.id is null then 'missing_harvest_gate'
    when hg.gate_status in ('ready_for_watch','harvest_watch') and hg.harvest_readiness_task_id is null then 'missing_harvest_readiness_task'
    when hg.gate_status='harvest_watch' and coalesce(readiness_task.status,'open')<>'done' then 'harvest_readiness_pending'
    when hg.gate_status='harvest_ready' and hg.harvest_task_id is not null then 'harvest_task_ready'
    when hg.gate_status in ('failed','cancelled') then hg.gate_status
    else 'pass'
  end audit_status
from lot_scope ls
join atlas.production_lots pl on pl.id=ls.production_lot_id
join atlas.production_programs pp on pp.id=pl.program_id
left join placement_counts pc on pc.production_lot_id=pl.id
left join stand_counts sc on sc.production_lot_id=pl.id
left join care_state_counts csc on csc.production_lot_id=pl.id
left join care_counts ca on ca.production_lot_id=pl.id
left join atlas.production_harvest_rules hr on hr.production_lot_id=pl.id
left join atlas.production_harvest_gates hg on hg.production_lot_id=pl.id
left join atlas.tasks owner_task on owner_task.id=hg.owner_decision_task_id
left join atlas.tasks readiness_task on readiness_task.id=hg.harvest_readiness_task_id
left join atlas.tasks harvest_task on harvest_task.id=hg.harvest_task_id;

revoke all on atlas.production_field_to_harvest_readiness_v1 from public,anon,authenticated;
revoke all on atlas.production_field_continuity_audit_v1 from public,anon,authenticated;
grant select on atlas.production_field_to_harvest_readiness_v1 to service_role;
grant select on atlas.production_field_continuity_audit_v1 to service_role;