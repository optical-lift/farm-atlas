create or replace view atlas.workflow_task_coverage_v1
with (security_invoker=true)
as
select
  t.id as task_id,
  t.farm_id,
  t.title,
  t.status,
  t.due_date,
  t.generated_from,
  t.generated_from_id,
  t.parent_task_id,
  lower(coalesce(t.metadata->>'relationship_kind','')) as relationship_kind,
  case
    when exists (
      select 1 from atlas.workflow_handoffs h
      where h.farm_id=t.farm_id and h.target_task_id=t.id and h.active
    ) then 'generic_handoff_target'
    when exists (
      select 1 from atlas.workflow_handoffs h
      where h.farm_id=t.farm_id and h.source_kind='task' and h.source_id=t.id and h.active
    ) then 'generic_handoff_source'
    when t.generated_from in (
      'germination_workflow','germination_harvest_watch','triggered_sequence',
      'crop_cycle_milestone','production_calendar','production_succession',
      'retroactive_crop_profile','recurring_task'
    ) then 'specialized_engine'
    when t.generated_from='task_follow_up' then 'delayed_followup_engine'
    else 'uncovered'
  end as coverage,
  (
    t.parent_task_id is not null
    and (
      t.generated_from in ('workflow_handoff','cascade_trigger','readiness_gate','task_follow_up')
      or lower(coalesce(t.metadata->>'relationship_kind','')) in ('downstream','handoff','readiness_gate')
      or t.metadata ? 'trigger_condition'
      or t.metadata ? 'trigger_on_parent_status'
      or lower(coalesce(t.metadata->>'cascade_trigger','false')) in ('true','yes','1')
      or lower(coalesce(t.metadata->>'requires_source_ready','false')) in ('true','yes','1')
    )
  ) as invalid_parent_link,
  t.metadata
from atlas.tasks t
where t.status in ('open','blocked')
  and (
    t.generated_from in (
      'workflow_handoff','cascade_trigger','readiness_gate','task_follow_up',
      'germination_workflow','germination_harvest_watch','triggered_sequence',
      'crop_cycle_milestone','production_calendar','production_succession',
      'retroactive_crop_profile','recurring_task'
    )
    or lower(coalesce(t.metadata->>'relationship_kind','')) in ('downstream','handoff','readiness_gate')
    or t.metadata ? 'source_task_id'
    or t.metadata ? 'source_cutting_task_id'
    or t.metadata ? 'source_purchase_task_id'
    or t.metadata ? 'source_sowing_task_id'
    or t.metadata ? 'trigger_source_task_id'
  );

revoke all on atlas.workflow_task_coverage_v1 from public,anon,authenticated;
grant select on atlas.workflow_task_coverage_v1 to service_role;

comment on view atlas.workflow_task_coverage_v1 is
  'Coverage audit for active sequential farm work. Any coverage=uncovered or invalid_parent_link=true requires correction before release.';
