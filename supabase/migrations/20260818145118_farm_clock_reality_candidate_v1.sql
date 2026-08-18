create or replace function atlas.farm_clock_reality_candidates_v1(
  p_farm_id uuid,
  p_membership_id uuid,
  p_work_date date default null
) returns table(
  task_id uuid,
  legacy_presentation_state text,
  legacy_presentation_reason text,
  lane_order integer,
  legacy_selection_rank bigint,
  work_lane text,
  commitment_kind text,
  effort_units numeric,
  budget_units numeric,
  notification_planned boolean,
  legacy_overload boolean,
  title text,
  priority text,
  due_date date,
  expected_active_minutes integer,
  physical_load text,
  consequence_tier integer,
  reality_warrant_class text,
  reality_warrant_order integer,
  subject_state jsonb,
  fitting_operation jsonb,
  operation_window jsonb,
  claim_capacity_context jsonb,
  jurisdiction jsonb,
  truth_boundary jsonb
)
language sql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
with selected as materialized (
  select s.*,t.title,t.priority,t.due_date,t.task_type,t.operation_class,
         t.assigned_membership_id,t.assigned_user_id,t.visibility_scope,t.planned_occurrence_id,
         capacity.expected_active_minutes,capacity.physical_load,
         atlas.task_effective_delay_consequence_v1(t.id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)) as consequence,
         atlas.task_worker_day_deferral_v1(t.id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)) as deferral,
         atlas.task_temporally_eligible_v1(t.id,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)) as temporally_eligible
  from atlas.presented_work_selection_rows_v1(p_farm_id,p_membership_id,p_work_date) s
  join atlas.tasks t on t.id=s.task_id
  cross join lateral atlas.task_capacity_plan_v1(t,coalesce(p_work_date,(now() at time zone 'America/Chicago')::date)) capacity
),
crop_subjects as (
  select link.task_id,count(*)::integer as subject_count,
         jsonb_agg(jsonb_build_object(
           'subjectKind','crop_cycle','subjectId',cycle.id,'subjectKey',cycle.crop_cycle_key,
           'linkRole',link.role,'lifecycleStatus',cycle.lifecycle_status
         ) order by cycle.id) as subjects
  from atlas.task_crop_cycles link
  join selected s on s.task_id=link.task_id
  join atlas.crop_cycles cycle on cycle.id=link.crop_cycle_id
  group by link.task_id
),
production_subjects as (
  select link.task_id,count(*)::integer as subject_count,
         jsonb_agg(jsonb_build_object(
           'subjectKind','production_lot','subjectId',lot.id,'subjectKey',lot.stable_key,
           'linkRole',link.link_role,'lifecycleStatus',lot.lifecycle_status
         ) order by lot.id) as subjects
  from atlas.production_lot_tasks link
  join selected s on s.task_id=link.task_id
  join atlas.production_lots lot on lot.id=link.production_lot_id
  group by link.task_id
),
rhythm_subjects as (
  select state.current_task_id as task_id,count(*)::integer as subject_count,
         jsonb_agg(jsonb_build_object(
           'subjectKind',state.subject_kind,'subjectId',state.subject_id,
           'rhythmStateId',state.id,'rhythmKey',state.rhythm_key,'state',state.state
         ) order by state.id) as subjects
  from atlas.rhythm_state state
  join selected s on s.task_id=state.current_task_id
  group by state.current_task_id
),
target as (
  select fm.role,fm.user_id
  from atlas.farm_memberships fm
  where fm.id=p_membership_id and fm.farm_id=p_farm_id and fm.active=true
  limit 1
),
enriched as (
  select s.*,
         coalesce(crop.subject_count,0) as crop_subject_count,
         coalesce(prod.subject_count,0) as production_subject_count,
         coalesce(rhythm.subject_count,0) as rhythm_subject_count,
         coalesce(crop.subjects,'[]'::jsonb) as crop_subjects,
         coalesce(prod.subjects,'[]'::jsonb) as production_subjects,
         coalesce(rhythm.subjects,'[]'::jsonb) as rhythm_subjects,
         occurrence.id as occurrence_id,occurrence.source_kind as occurrence_source_kind,
         occurrence.source_id as occurrence_source_id,occurrence.state as occurrence_state,
         target.role as target_role,target.user_id as target_user_id,
         case
           when coalesce(crop.subject_count,0)+coalesce(prod.subject_count,0)>0 then 0
           when coalesce(rhythm.subject_count,0)>0 then 1
           when occurrence.source_kind is not null and occurrence.source_id is not null then 2
           when s.commitment_kind='hard_date' and s.due_date is not null then 3
           when occurrence.id is not null then 4
           else 9
         end as warrant_order,
         case
           when coalesce(crop.subject_count,0)+coalesce(prod.subject_count,0)>0 then 'canonical_domain_subject'
           when coalesce(rhythm.subject_count,0)>0 then 'canonical_rhythm_subject'
           when occurrence.source_kind is not null and occurrence.source_id is not null then 'source_linked_occurrence'
           when s.commitment_kind='hard_date' and s.due_date is not null then 'explicit_hard_commitment'
           when occurrence.id is not null then 'occurrence_carrier'
           else 'task_carrier_only'
         end as warrant_class
  from selected s
  left join crop_subjects crop on crop.task_id=s.task_id
  left join production_subjects prod on prod.task_id=s.task_id
  left join rhythm_subjects rhythm on rhythm.task_id=s.task_id
  left join atlas.planned_work_occurrences occurrence on occurrence.id=s.planned_occurrence_id
  left join target on true
)
select
  e.task_id,e.presentation_state,e.presentation_reason,e.lane_order,e.selection_rank,
  e.work_lane,e.commitment_kind,e.effort_units,e.budget_units,e.notification_planned,e.overload,
  e.title,e.priority,e.due_date,e.expected_active_minutes,e.physical_load,
  case when coalesce(e.consequence->>'effectiveTier','') ~ '^[1-6]$' then (e.consequence->>'effectiveTier')::integer else null end,
  e.warrant_class,e.warrant_order,
  jsonb_build_object(
    'cropCycles',e.crop_subjects,
    'productionLots',e.production_subjects,
    'rhythms',e.rhythm_subjects,
    'occurrence',case when e.occurrence_id is null then null else jsonb_strip_nulls(jsonb_build_object(
      'id',e.occurrence_id,'sourceKind',e.occurrence_source_kind,'sourceId',e.occurrence_source_id,'state',e.occurrence_state
    )) end
  ),
  jsonb_strip_nulls(jsonb_build_object(
    'operationClass',e.operation_class,
    'taskType',e.task_type,
    'operationEvidenceClass',case
      when e.warrant_order=0 then 'task_carrier_on_canonical_domain_subject'
      when e.warrant_order=1 then 'task_carrier_on_canonical_rhythm_subject'
      when e.warrant_order<=3 then 'task_carrier_on_explicit_source_or_commitment'
      else 'task_carrier_only'
    end,
    'fullRealityExpressionRequiredForDomainFit',true
  )),
  jsonb_build_object(
    'serviceDate',coalesce(p_work_date,(now() at time zone 'America/Chicago')::date),
    'dueDate',e.due_date,
    'temporallyEligible',e.temporally_eligible,
    'deferral',e.deferral
  ),
  jsonb_build_object(
    'legacyPresentationState',e.presentation_state,
    'legacyPresentationReason',e.presentation_reason,
    'expectedActiveMinutes',e.expected_active_minutes,
    'physicalLoad',e.physical_load,
    'consequence',e.consequence,
    'capacityArbitration','presented_work_selection_rows_v2'
  ),
  jsonb_build_object(
    'targetMembershipId',p_membership_id,
    'targetRole',e.target_role,
    'assignedMembershipId',e.assigned_membership_id,
    'assignedUserId',e.assigned_user_id,
    'visibilityScope',e.visibility_scope
  ),
  jsonb_build_object(
    'taskRemainsExecutionCarrier',true,
    'realityWarrantDoesNotBypassReadiness',true,
    'realityWarrantDoesNotBypassDestination',true,
    'realityWarrantDoesNotBypassTemporalWindow',true,
    'realityWarrantDoesNotBypassClaimOrCapacityFit',true,
    'fullRealityPacketIsExplanationNotClockHotPath',true,
    'storedPriorityRanksAfterRealityWarrantAmongOtherwiseEquivalentFlexibleWork',true
  )
from enriched e;
$$;

revoke all on function atlas.farm_clock_reality_candidates_v1(uuid,uuid,date) from public,anon,authenticated;
grant execute on function atlas.farm_clock_reality_candidates_v1(uuid,uuid,date) to service_role;