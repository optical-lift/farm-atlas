create table if not exists atlas.task_completion_impact_policies (
  action_family text primary key,
  expectation text not null check (expectation in ('required','contextual','record_only')),
  acceptable_state_impacts text[] not null default '{}',
  minimum_state_impacts integer not null default 1 check (minimum_state_impacts >= 0),
  description text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into atlas.task_completion_impact_policies
  (action_family, expectation, acceptable_state_impacts, minimum_state_impacts, description)
values
  ('weed','required',array['maintenance','object_event','object_state'],1,'Weeding must update the maintained object or maintenance history.'),
  ('weeding','required',array['maintenance','object_event','object_state'],1,'Weeding must update the maintained object or maintenance history.'),
  ('mow','required',array['maintenance','object_event','object_state'],1,'Mowing must update the maintained object or maintenance history.'),
  ('mowing','required',array['maintenance','object_event','object_state'],1,'Mowing must update the maintained object or maintenance history.'),
  ('water','required',array['object_event','object_state'],1,'Watering must update the watered object state.'),
  ('watering','required',array['object_event','object_state'],1,'Watering must update the watered object state.'),
  ('sow','required',array['crop_cycle','production_succession','planting_claim'],1,'Sowing must create or advance a crop record or production succession.'),
  ('seed_sowing','required',array['crop_cycle','production_succession','planting_claim'],1,'Sowing must create or advance a crop record or production succession.'),
  ('seed_starting','required',array['crop_cycle','production_succession','workflow_handoff','next_task'],1,'Seed starting must advance the crop lifecycle or schedule its next stage.'),
  ('plant','required',array['planting_claim','crop_cycle','object_event','object_state'],1,'Planting must change the real bed or crop record.'),
  ('planting','required',array['planting_claim','crop_cycle','object_event','object_state'],1,'Planting must change the real bed or crop record.'),
  ('transplant','required',array['planting_claim','crop_cycle','object_event','object_state'],1,'Transplanting must change the real bed or crop record.'),
  ('transplanting','required',array['planting_claim','crop_cycle','object_event','object_state'],1,'Transplanting must change the real bed or crop record.'),
  ('germination_check','required',array['crop_cycle','workflow_handoff','next_task'],1,'A germination result must update the crop cycle or create the next response.'),
  ('verify','required',array['crop_cycle','workflow_handoff','next_task'],1,'A biological verification must update crop state or the next response.'),
  ('check','contextual',array['crop_cycle','workflow_handoff','maintenance','object_event','object_state','next_task'],1,'A general check should update state when it represents readiness or condition.'),
  ('harvest','required',array['crop_cycle','object_event','object_state','next_task'],1,'Harvest must update crop or object history.'),
  ('harvest_watch','required',array['crop_cycle','workflow_handoff','next_task'],1,'A harvest-window result must advance the crop lifecycle or next work.'),
  ('harvest_window','required',array['crop_cycle','workflow_handoff','next_task'],1,'A harvest-window result must advance the crop lifecycle or next work.'),
  ('clear','required',array['crop_cycle','object_event','object_state','workflow_handoff','next_task'],1,'Clearing a bed must close crop occupancy or unlock the next use.'),
  ('bed_turnover','required',array['crop_cycle','object_event','object_state','workflow_handoff','next_task'],1,'Bed turnover must close crop occupancy or unlock the next use.'),
  ('propagate','required',array['workflow_handoff','crop_cycle','next_task'],1,'Propagation must schedule or record the next biological stage.'),
  ('propagation','required',array['workflow_handoff','crop_cycle','next_task'],1,'Propagation must schedule or record the next biological stage.'),
  ('propagation_start','required',array['workflow_handoff','crop_cycle','next_task'],1,'Propagation must schedule or record the next biological stage.'),
  ('pot_up','contextual',array['crop_cycle','workflow_handoff','next_task'],1,'Potting up should advance a crop or tray lifecycle when one is modeled.'),
  ('hardening_off','contextual',array['crop_cycle','workflow_handoff','next_task'],1,'Hardening should advance a crop or tray lifecycle when one is modeled.'),
  ('grow_room_check','contextual',array['crop_cycle','workflow_handoff','next_task'],1,'Grow-room checks should advance the modeled crop stage when applicable.'),
  ('purchase','required',array['workflow_handoff','next_task'],1,'A purchase completion must initiate delivery or availability confirmation; it cannot itself prove availability.'),
  ('confirm_resource','required',array['workflow_handoff','next_task'],1,'Resource confirmation must unlock or schedule the work that requires it.'),
  ('checklist_step','contextual',array['crop_cycle','planting_claim','production_succession','workflow_handoff','next_task'],1,'Checklist steps inherit state changes from their structured parent workflow.'),
  ('owner','record_only','{}',0,'Owner administrative work requires an auditable completion record but not always field state.'),
  ('venue','record_only','{}',0,'Venue work requires an auditable completion record but not crop state.'),
  ('build','record_only','{}',0,'Build work requires an auditable completion record but not crop state.'),
  ('support','record_only','{}',0,'Support work requires an auditable completion record but not crop state.'),
  ('infrastructure','record_only','{}',0,'Infrastructure work requires an auditable completion record but not crop state.'),
  ('kids','record_only','{}',0,'Household or helper work requires an auditable completion record but not crop state.'),
  ('soil_blocking','contextual',array['crop_cycle','workflow_handoff','next_task'],1,'Soil blocking should affect a tray workflow when tied to a crop plan.'),
  ('anna','contextual',array['crop_cycle','planting_claim','production_succession','workflow_handoff','maintenance','object_event','object_state','next_task'],1,'Legacy generic Anna actions require semantic review until normalized.'),
  ('general','record_only','{}',0,'General work requires an auditable completion record.')
on conflict (action_family) do update set
  expectation=excluded.expectation,
  acceptable_state_impacts=excluded.acceptable_state_impacts,
  minimum_state_impacts=excluded.minimum_state_impacts,
  description=excluded.description,
  updated_at=now();

create or replace view atlas.task_completion_impact_audit_v1
with (security_invoker=true)
as
with completed as (
  select
    t.id as task_id, t.farm_id, t.title, t.task_type, t.action_key,
    t.completed_at, t.due_date, t.zone_id, t.metadata,
    lower(coalesce(nullif(t.action_key,''), nullif(t.metadata->>'work_route',''), t.task_type, 'general')) as action_family
  from atlas.tasks t
  where t.status='done' and t.completed_at is not null
), detected as (
  select c.*,
    exists(select 1 from atlas.task_transitions tr where tr.task_id=c.task_id and tr.next_status='done') as has_done_transition,
    exists(select 1 from atlas.task_outcome_events toe where toe.task_id=c.task_id and toe.outcome='done') as has_done_outcome,
    exists(
      select 1 from atlas.field_logs fl
      where fl.metadata->>'task_id'=c.task_id::text
         or fl.id in (select tr.field_log_id from atlas.task_transitions tr where tr.task_id=c.task_id and tr.field_log_id is not null)
    ) as has_field_log,
    exists(
      select 1 from atlas.object_activity_events oae
      where oae.metadata->>'task_id'=c.task_id::text
         or oae.field_log_id in (select tr.field_log_id from atlas.task_transitions tr where tr.task_id=c.task_id and tr.field_log_id is not null)
    ) as has_object_event,
    exists(select 1 from atlas.object_state os where os.metadata->>'last_task_id'=c.task_id::text) as has_object_state,
    exists(select 1 from atlas.maintenance_history mh where mh.source_task_id=c.task_id) as has_maintenance,
    exists(
      select 1 from atlas.crop_cycles cc
      where cc.source_task_id=c.task_id
         or cc.metadata->>'task_id'=c.task_id::text
         or cc.source_event_id in (select oae.id from atlas.object_activity_events oae where oae.metadata->>'task_id'=c.task_id::text)
    ) as has_crop_cycle,
    exists(
      select 1 from atlas.planting_claims pc
      where pc.metadata->>'task_id'=c.task_id::text
         or pc.field_log_id in (select tr.field_log_id from atlas.task_transitions tr where tr.task_id=c.task_id and tr.field_log_id is not null)
    ) as has_planting_claim,
    exists(select 1 from atlas.production_successions ps where ps.sow_task_id=c.task_id or ps.metadata->>'task_id'=c.task_id::text) as has_production_succession,
    exists(
      select 1
      from atlas.workflow_events we
      join atlas.workflow_handoffs wh on wh.satisfied_by_event_id=we.id
      where we.source_kind='task' and we.source_id=c.task_id and wh.satisfied_at is not null
    ) as has_workflow_handoff,
    exists(
      select 1 from atlas.tasks nt
      where nt.generated_from_id=c.task_id
        and nt.generated_from in ('recurring_task','task_follow_up','workflow_handoff','triggered_sequence','germination_harvest_watch','germination_workflow')
    ) as has_next_task
  from completed c
), assembled as (
  select d.*,
    array_remove(array[
      case when has_done_transition then 'transition' end,
      case when has_done_outcome then 'outcome' end,
      case when has_field_log then 'field_log' end
    ],null)::text[] as record_impacts,
    array_remove(array[
      case when has_object_event then 'object_event' end,
      case when has_object_state then 'object_state' end,
      case when has_maintenance then 'maintenance' end,
      case when has_crop_cycle then 'crop_cycle' end,
      case when has_planting_claim then 'planting_claim' end,
      case when has_production_succession then 'production_succession' end,
      case when has_workflow_handoff then 'workflow_handoff' end,
      case when has_next_task then 'next_task' end
    ],null)::text[] as state_impacts
  from detected d
)
select
  a.task_id, a.farm_id, a.title, a.task_type, a.action_key, a.action_family,
  a.completed_at, a.due_date, a.zone_id,
  case when a.has_done_transition then 'canonical_transition' else 'legacy_or_specialized_direct' end as completion_origin,
  a.record_impacts, a.state_impacts,
  p.expectation, p.acceptable_state_impacts, p.minimum_state_impacts,
  p.description as policy_description,
  coalesce((select count(*) from unnest(a.state_impacts) i where i=any(p.acceptable_state_impacts)),0) as matching_state_impact_count,
  case
    when p.action_family is null then 'unclassified'
    when not a.has_done_transition and cardinality(a.state_impacts)=0 then 'legacy_unstructured'
    when p.expectation='record_only' and cardinality(a.record_impacts)>0 then 'pass'
    when p.expectation='record_only' then 'record_gap'
    when coalesce((select count(*) from unnest(a.state_impacts) i where i=any(p.acceptable_state_impacts)),0) >= p.minimum_state_impacts then 'pass'
    when p.expectation='contextual' then 'contextual_review'
    when not a.has_done_transition then 'legacy_state_gap'
    else 'state_gap'
  end as audit_status
from assembled a
left join atlas.task_completion_impact_policies p on p.action_family=a.action_family;

create or replace view atlas.task_completion_impact_summary_v1
with (security_invoker=true)
as
select
  farm_id, action_family, audit_status,
  count(*) as task_count,
  max(completed_at) as latest_completion,
  array_agg(task_id order by completed_at desc) filter (where audit_status in ('state_gap','record_gap','contextual_review','unclassified')) as review_task_ids
from atlas.task_completion_impact_audit_v1
group by farm_id, action_family, audit_status;
