-- P7 — Continuity Auditor vNext.
-- Adds explicit Requirement → Gap → Acquisition → Warrant continuity checks while
-- preserving the existing farm continuity auditor as an internal baseline.

create or replace function atlas.requirement_continuity_audit_v1(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_families jsonb:='[]'::jsonb;
  v_items jsonb:='[]'::jsonb;
  v_high integer:=0;
  v_medium integer:=0;
  v_total integer:=0;
  v_requirement_missing integer:=0;
  v_blocked_no_path integer:=0;
  v_gap_no_jurisdiction integer:=0;
  v_gap_no_continuation integer:=0;
  v_reconstructed_excluded integer:=0;
  v_clock_reset integer:=0;
  v_worker_no_action integer:=0;
  v_perfect_history_dependency integer:=0;
  v_hidden_consequence integer:=0;
  v_duplicate_acquisition integer:=0;
  v_false_principal_escalation integer:=0;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  with crop_snapshots as materialized (
    select c.id,c.crop_cycle_key,c.crop_label,c.variety,c.crop_profile_id,c.cycle_state,c.lifecycle_status,
           atlas.crop_cycle_requirement_snapshot_v1(c.id,v_day) as snapshot,
           atlas.crop_cycle_biological_progression_state_v1(c.id,v_day) as biological
    from atlas.crop_cycles c
    where c.farm_id=p_farm_id and c.lifecycle_status='active'
  ), crop_expected as materialized (
    select cs.*,
           nullif(cs.snapshot->>'requirementOperationKey','') as expected_action,
           coalesce((cs.snapshot->>'transplantResponseRequired')::boolean,false) as response_required,
           exists(
             select 1 from atlas.state_consequence_instances i
             where i.farm_id=p_farm_id and i.subject_kind='crop_cycle' and i.subject_id=cs.id
               and i.status='open' and i.consequence_role='operation_requirement'
               and i.action_key=nullif(cs.snapshot->>'requirementOperationKey','')
           ) as requirement_expressed
    from crop_snapshots cs
  ), open_requirements as materialized (
    select i.*,
           case when i.subject_kind='crop_cycle'
             then atlas.crop_operation_execution_warrant_v1(i.subject_id,i.action_key,i.id)
             else jsonb_build_object('requirementExists',true,'executionReady',false,'warrant','subject_warrant_adapter_required')
           end as warrant
    from atlas.state_consequence_instances i
    where i.farm_id=p_farm_id and i.status='open' and i.consequence_role='operation_requirement'
  ), open_acquisition as materialized (
    select i.*,atlas.truth_acquisition_jurisdiction_v1(i.id) as jurisdiction
    from atlas.state_consequence_instances i
    where i.farm_id=p_farm_id and i.status='open' and i.consequence_role='truth_acquisition'
  ), requirement_history as materialized (
    select i.id,
           min(case
             when coalesce(e.state_snapshot->>'requirementOnsetDate','') ~ '^\d{4}-\d{2}-\d{2}$'
               then (e.state_snapshot->>'requirementOnsetDate')::date
             when coalesce(e.state_snapshot->>'requirementKnownActiveBy','') ~ '^\d{4}-\d{2}-\d{2}$'
               then (e.state_snapshot->>'requirementKnownActiveBy')::date
             else null::date
           end) as earliest_recorded_requirement_date
    from atlas.state_consequence_instances i
    join atlas.state_consequence_events e on e.instance_id=i.id and e.event_kind='released'
    where i.farm_id=p_farm_id and i.status='open' and i.consequence_role='operation_requirement'
    group by i.id
  ), worker_card_packets as materialized (
    select fm.id as membership_id,card.value as card
    from atlas.farm_memberships fm
    cross join lateral (
      select coalesce(array_agg(p.task_id order by p.sort_order,p.task_id),array[]::uuid[]) as task_ids
      from atlas.worker_day_task_placements p
      where p.farm_id=p_farm_id and p.membership_id=fm.id and p.service_date=v_day and p.state='placed'
    ) ids
    cross join lateral jsonb_array_elements(
      atlas.worker_day_operational_task_cards_v3(p_farm_id,fm.id,v_day,ids.task_ids)
    ) card
    where fm.farm_id=p_farm_id and fm.active=true and fm.role='farm_hand'
  ), duplicate_acquisition_groups as materialized (
    select source_requirement_instance_id,action_key,count(*)::integer as path_count,
           jsonb_agg(id order by released_at,id) as instance_ids
    from atlas.state_consequence_instances
    where farm_id=p_farm_id and status='open' and consequence_role='truth_acquisition'
      and source_requirement_instance_id is not null
    group by source_requirement_instance_id,action_key
    having count(*)>1
  ), duplicate_carrier_groups as materialized (
    select nullif(t.metadata->>'source_requirement_instance_id','')::uuid as source_requirement_instance_id,
           coalesce(nullif(t.metadata->>'gap_kind',''),t.action_key) as gap_key,
           count(*)::integer as carrier_count,
           jsonb_agg(t.id order by t.created_at,t.id) as carrier_task_ids
    from atlas.tasks t
    where t.farm_id=p_farm_id and t.status in ('open','blocked')
      and coalesce(t.metadata->>'source_requirement_instance_id','') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    group by nullif(t.metadata->>'source_requirement_instance_id','')::uuid,
             coalesce(nullif(t.metadata->>'gap_kind',''),t.action_key)
    having count(*)>1
  ), issue_rows as (
    -- 1. Reality says a requirement is due, but no Requirement Expression instance exists.
    select 'requirement_due_without_expression'::text issue_key,'high'::text severity,
           'crop_cycle'::text subject_kind,ce.id subject_id,null::uuid source_requirement_instance_id,
           null::uuid truth_acquisition_instance_id,null::uuid carrier_task_id,
           jsonb_strip_nulls(jsonb_build_object(
             'cropCycleId',ce.id,'cropCycleKey',ce.crop_cycle_key,'cropLabel',ce.crop_label,
             'cycleState',ce.cycle_state,'expectedAction',ce.expected_action,
             'requirementKnownActiveBy',ce.snapshot->>'requirementKnownActiveBy',
             'requirementTimeClass',ce.snapshot->>'requirementTimeClass',
             'profilePresent',ce.snapshot->'profilePresent',
             'meaning','Current reality establishes a required response, but Atlas has no open operation_requirement instance for it.'
           )) detail
    from crop_expected ce
    where ce.response_required and ce.expected_action is not null and not ce.requirement_expressed

    union all
    -- 2. A requirement is not executable and has no lawful acquisition/repair/preparation path.
    select 'blocked_execution_without_lawful_continuation','high',r.subject_kind,r.subject_id,r.id,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'requirementInstanceId',r.id,'actionKey',r.action_key,'warrant',r.warrant,
             'meaning','Execution is not warranted, but no open acquisition, repair, or preparation consequence is causally linked to the requirement.'
           ))
    from open_requirements r
    where not coalesce((r.warrant->>'executionReady')::boolean,false)
      and not exists(
        select 1 from atlas.state_consequence_instances child
        where child.source_requirement_instance_id=r.id and child.status='open'
          and child.consequence_role in ('truth_acquisition','repair_or_resolution','preparation')
      )

    union all
    -- 3. A consequential gap lacks a lawful jurisdiction or a resolvable human custodian where one is required.
    select 'consequential_gap_without_jurisdiction','high',a.subject_kind,a.subject_id,a.source_requirement_instance_id,a.id,a.carrier_task_id,
           jsonb_strip_nulls(jsonb_build_object(
             'truthAcquisitionInstanceId',a.id,'actionKey',a.action_key,'jurisdiction',a.jurisdiction,
             'meaning','A consequential truth gap does not resolve to a lawful jurisdiction/custodian.'
           ))
    from open_acquisition a
    where coalesce(nullif(a.jurisdiction->>'jurisdiction',''),'') not in ('owner','manager','farm_operations','external','system')
       or (a.jurisdiction->>'jurisdiction' in ('owner','manager') and not coalesce((a.jurisdiction->>'resolvedToPerson')::boolean,false))

    union all
    -- 4. Jurisdiction exists, but no active task/cue/system continuation is carrying the acquisition move.
    select 'gap_with_jurisdiction_without_acquisition_continuation','high',a.subject_kind,a.subject_id,a.source_requirement_instance_id,a.id,a.carrier_task_id,
           jsonb_strip_nulls(jsonb_build_object(
             'truthAcquisitionInstanceId',a.id,'actionKey',a.action_key,'jurisdiction',a.jurisdiction,
             'carrierTaskId',a.carrier_task_id,
             'meaning','The gap has jurisdiction but no active human acquisition continuation.'
           ))
    from open_acquisition a
    where a.jurisdiction->>'jurisdiction' in ('owner','manager','farm_operations','external')
      and not exists(select 1 from atlas.tasks t where t.id=a.carrier_task_id and t.status in ('open','blocked'))
      and not exists(
        select 1 from atlas.worker_day_cues c
        where c.farm_id=p_farm_id and c.status not in ('resolved','dismissed')
          and (
            c.payload->>'stateConsequenceInstanceId'=a.id::text
            or c.payload->>'state_consequence_instance_id'=a.id::text
            or c.result_contract->>'stateConsequenceInstanceId'=a.id::text
            or c.result_contract->>'state_consequence_instance_id'=a.id::text
          )
      )

    union all
    -- 5. Current living evidence establishes a requirement but a legacy biological reader excludes the body.
    select 'reconstructed_living_body_excluded_from_progression','medium','crop_cycle',ce.id,
           (select i.id from atlas.state_consequence_instances i where i.farm_id=p_farm_id and i.subject_kind='crop_cycle' and i.subject_id=ce.id and i.status='open' and i.consequence_role='operation_requirement' and i.action_key=ce.expected_action order by i.released_at,i.id limit 1),
           null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'cropCycleId',ce.id,'cropCycleKey',ce.crop_cycle_key,'cropLabel',ce.crop_label,
             'cycleState',ce.cycle_state,'profilePresent',ce.snapshot->'profilePresent',
             'biologicalProgression',ce.biological,
             'requirementExpressionProtected',ce.requirement_expressed,
             'meaning','Current evidence says the living body requires a response while the legacy progression reader says not_applicable; incomplete model lineage must not erase the body.'
           ))
    from crop_expected ce
    where ce.response_required
      and not coalesce((ce.snapshot->>'profilePresent')::boolean,false)
      and not coalesce((ce.biological->>'applicable')::boolean,false)

    union all
    -- 6. Current requirement time is later than its own earliest released evidence.
    select 'requirement_clock_reset_detected','high',r.subject_kind,r.subject_id,r.id,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'requirementInstanceId',r.id,'actionKey',r.action_key,
             'currentRequirementDate',coalesce(r.requirement_onset_date,r.requirement_known_active_by),
             'earliestRecordedRequirementDate',h.earliest_recorded_requirement_date,
             'meaning','The requirement clock moved forward relative to its own release history; resolving a gap or reclassifying warrant must not reset lateness.'
           ))
    from open_requirements r
    join requirement_history h on h.id=r.id
    where h.earliest_recorded_requirement_date is not null
      and coalesce(r.requirement_onset_date,r.requirement_known_active_by) is not null
      and coalesce(r.requirement_onset_date,r.requirement_known_active_by)>h.earliest_recorded_requirement_date

    union all
    -- 7. A rendered Worker Day operational card claims work while execution readiness says no action is available.
    select 'worker_day_card_without_available_action','high','task',nullif(w.card->>'task_id','')::uuid,
           null::uuid,null::uuid,nullif(w.card->>'task_id','')::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'membershipId',w.membership_id,'taskId',w.card->>'task_id','title',w.card->>'title',
             'executionReadiness',w.card->'execution_readiness',
             'meaning','Worker Day rendered an operational card that is not executable for the assigned worker.'
           ))
    from worker_card_packets w
    where coalesce(w.card->>'status','')<>'done'
      and not coalesce((w.card#>>'{execution_readiness,executionReady}')::boolean,
                       (w.card#>>'{execution_readiness,ready}')::boolean,false)

    union all
    -- 8. Missing historical/model coverage causes a currently witnessed requirement to fail to materialize.
    select 'requirement_generation_depends_on_perfect_history','high','crop_cycle',ce.id,null::uuid,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'cropCycleId',ce.id,'cropCycleKey',ce.crop_cycle_key,'cropLabel',ce.crop_label,
             'cycleState',ce.cycle_state,'profilePresent',ce.snapshot->'profilePresent',
             'expectedAction',ce.expected_action,'currentEvidence',ce.snapshot->'requirementEpistemicBasis',
             'meaning','Current physical evidence is sufficient to establish a requirement, but incomplete historical/model coverage prevented the requirement instance from materializing.'
           ))
    from crop_expected ce
    where ce.response_required and not ce.requirement_expressed
      and not coalesce((ce.snapshot->>'profilePresent')::boolean,false)

    union all
    -- 9. An unresolved decision carrier exists but does not surface the source requirement/consequence.
    select 'unresolved_decision_hides_source_consequence','medium',a.subject_kind,a.subject_id,a.source_requirement_instance_id,a.id,t.id,
           jsonb_strip_nulls(jsonb_build_object(
             'truthAcquisitionInstanceId',a.id,'carrierTaskId',t.id,'title',t.title,
             'sourceRequirementInstanceId',a.source_requirement_instance_id,
             'requirementStatement',t.metadata->>'requirement_statement',
             'missingTruthStatement',t.metadata->>'missing_truth_statement',
             'meaning','A decision carrier is active but its human-facing contract does not preserve the source requirement and missing truth as separate statements.'
           ))
    from open_acquisition a
    join atlas.tasks t on t.id=a.carrier_task_id and t.status in ('open','blocked')
    where a.source_requirement_instance_id is not null
      and (
        nullif(t.metadata->>'source_requirement_instance_id','') is distinct from a.source_requirement_instance_id::text
        or nullif(t.metadata->>'requirement_statement','') is null
        or nullif(t.metadata->>'missing_truth_statement','') is null
      )

    union all
    -- 10a. More than one open truth-acquisition consequence serves the same requirement/action gap.
    select 'duplicate_acquisition_paths_for_one_gap','high',r.subject_kind,r.subject_id,d.source_requirement_instance_id,null::uuid,null::uuid,
           jsonb_build_object(
             'sourceRequirementInstanceId',d.source_requirement_instance_id,'actionKey',d.action_key,
             'pathCount',d.path_count,'truthAcquisitionInstanceIds',d.instance_ids,
             'meaning','One source requirement/action gap has multiple open truth-acquisition paths.'
           )
    from duplicate_acquisition_groups d
    join atlas.state_consequence_instances r on r.id=d.source_requirement_instance_id

    union all
    -- 10b. More than one active task carrier claims the same source requirement/gap.
    select 'duplicate_acquisition_paths_for_one_gap','high',r.subject_kind,r.subject_id,d.source_requirement_instance_id,null::uuid,null::uuid,
           jsonb_build_object(
             'sourceRequirementInstanceId',d.source_requirement_instance_id,'gapKey',d.gap_key,
             'carrierCount',d.carrier_count,'carrierTaskIds',d.carrier_task_ids,
             'meaning','One source requirement/gap has multiple active human task carriers.'
           )
    from duplicate_carrier_groups d
    join atlas.state_consequence_instances r on r.id=d.source_requirement_instance_id

    union all
    -- 11. Bell-derived Principal escalation exists without the required Principal ownership membrane crossing.
    select 'principal_escalation_without_ownership_membrane_crossing','high','operational_escalation',e.id,null::uuid,null::uuid,null::uuid,
           jsonb_strip_nulls(jsonb_build_object(
             'escalationId',e.id,'sourceSystem',e.source_system,'sourceType',e.source_type,'sourceId',e.source_id,
             'escalationKind',e.escalation_kind,'owningFunction',e.metadata->'owningFunction',
             'meaning','A generated farm-reality escalation reached Principal without evidence that the repair jurisdiction crossed the Principal membrane.'
           ))
    from atlas.operational_escalations e
    join atlas.portfolio_units u on u.id=e.portfolio_unit_id and u.linked_farm_id=p_farm_id
    where e.status in ('open','acknowledged') and e.source_system='farm_reality' and e.source_type='bell_repair_packet'
      and coalesce(e.metadata#>>'{owningFunction,jurisdiction}','')<>'principal'
  ), family_rows as (
    select issue_key,
           case when count(*) filter(where severity='high')>0 then 'high' else 'medium' end as family_severity,
           count(*)::integer as issue_count,
           jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'subjectKind',subject_kind,'subjectId',subject_id,
             'sourceRequirementInstanceId',source_requirement_instance_id,
             'truthAcquisitionInstanceId',truth_acquisition_instance_id,
             'carrierTaskId',carrier_task_id,
             'severity',severity,'detail',detail
           )) order by subject_kind,subject_id,source_requirement_instance_id,truth_acquisition_instance_id,carrier_task_id) as items
    from issue_rows
    group by issue_key
  )
  select
    coalesce((select jsonb_agg(jsonb_build_object('key',issue_key,'severity',family_severity,'count',issue_count,'items',items)
             order by case family_severity when 'high' then 1 else 2 end,issue_key) from family_rows),'[]'::jsonb),
    coalesce((select count(*) from issue_rows),0)::integer,
    coalesce((select count(*) from issue_rows where severity='high'),0)::integer,
    coalesce((select count(*) from issue_rows where severity='medium'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='requirement_due_without_expression'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='blocked_execution_without_lawful_continuation'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='consequential_gap_without_jurisdiction'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='gap_with_jurisdiction_without_acquisition_continuation'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='reconstructed_living_body_excluded_from_progression'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='requirement_clock_reset_detected'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='worker_day_card_without_available_action'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='requirement_generation_depends_on_perfect_history'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='unresolved_decision_hides_source_consequence'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='duplicate_acquisition_paths_for_one_gap'),0)::integer,
    coalesce((select count(*) from issue_rows where issue_key='principal_escalation_without_ownership_membrane_crossing'),0)::integer
  into v_families,v_total,v_high,v_medium,v_requirement_missing,v_blocked_no_path,
       v_gap_no_jurisdiction,v_gap_no_continuation,v_reconstructed_excluded,v_clock_reset,
       v_worker_no_action,v_perfect_history_dependency,v_hidden_consequence,
       v_duplicate_acquisition,v_false_principal_escalation;

  return jsonb_build_object(
    'contractVersion','requirement_continuity_audit_v1',
    'state',case when v_high>0 then 'requirement_continuity_repair_required' when v_medium>0 then 'requirement_continuity_attention' else 'requirement_continuity_sound' end,
    'farmId',p_farm_id,'asOfDate',v_day,'asOf',now(),
    'summary',jsonb_build_object(
      'totalIssueCount',v_total,'highPriorityIssueCount',v_high,'mediumPriorityIssueCount',v_medium,
      'requirementDueWithoutExpressionCount',v_requirement_missing,
      'blockedExecutionWithoutLawfulContinuationCount',v_blocked_no_path,
      'consequentialGapWithoutJurisdictionCount',v_gap_no_jurisdiction,
      'gapWithJurisdictionWithoutAcquisitionContinuationCount',v_gap_no_continuation,
      'reconstructedLivingBodyExcludedFromProgressionCount',v_reconstructed_excluded,
      'requirementClockResetCount',v_clock_reset,
      'workerDayCardWithoutAvailableActionCount',v_worker_no_action,
      'perfectHistoryDependencyCount',v_perfect_history_dependency,
      'unresolvedDecisionHidesSourceConsequenceCount',v_hidden_consequence,
      'duplicateAcquisitionPathCount',v_duplicate_acquisition,
      'principalEscalationWithoutOwnershipMembraneCount',v_false_principal_escalation
    ),
    'issueFamilies',v_families,
    'auditCoverage',jsonb_build_object(
      'requirementExpression',true,'executionWarrant',true,'gapCausality',true,'jurisdiction',true,
      'acquisitionContinuation',true,'partialHistoryLivingBodies',true,'requirementClockHistory',true,
      'workerDayActionability',true,'decisionConsequenceVisibility',true,'duplicateAcquisition',true,'principalMembrane',true
    ),
    'truthBoundary',jsonb_build_object(
      'requirementIsNotTask',true,'blockedExecutionDoesNotEraseRequirement',true,
      'missingProfileCannotExcuseMissingCurrentRequirement',true,'lawfulWaitIsNotFailureWhenAContinuationExists',true,
      'requirementTimeCannotBeResetByGapResolution',true,'workerCardRequiresAvailableAction',true,
      'oneGapHasOneActiveAcquisitionPath',true,'principalEscalationRequiresOwnershipMembraneCrossing',true,
      'auditDoesNotMutateDomainTruth',true
    ),
    'principalEscalationCreated',false
  );
end;
$function$;

revoke all on function atlas.requirement_continuity_audit_v1(uuid,date) from public,anon,authenticated;
grant execute on function atlas.requirement_continuity_audit_v1(uuid,date) to service_role;

-- Preserve the pre-P7 farm auditor as an internal baseline.
alter function atlas.farm_continuity_audit_v9(uuid,date)
  rename to farm_continuity_audit_pre_p7_v9;
revoke all on function atlas.farm_continuity_audit_pre_p7_v9(uuid,date) from public,anon,authenticated;
grant execute on function atlas.farm_continuity_audit_pre_p7_v9(uuid,date) to service_role;

create or replace function atlas.farm_continuity_audit_v10(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date:=coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_req jsonb;
  v_base_high integer:=0;
  v_base_medium integer:=0;
  v_base_combined_high integer:=0;
  v_base_combined_medium integer:=0;
  v_req_high integer:=0;
  v_req_medium integer:=0;
  v_state text;
begin
  if p_farm_id is null then raise exception 'A farm is required.' using errcode='22023'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  v_base:=atlas.farm_continuity_audit_pre_p7_v9(p_farm_id,v_day);
  v_req:=atlas.requirement_continuity_audit_v1(p_farm_id,v_day);

  v_base_high:=coalesce((v_base#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_base_medium:=coalesce((v_base#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_base_combined_high:=coalesce((v_base#>>'{summary,combinedHighPriorityIssueCount}')::integer,v_base_high);
  v_base_combined_medium:=coalesce((v_base#>>'{summary,combinedMediumPriorityIssueCount}')::integer,v_base_medium);
  v_req_high:=coalesce((v_req#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_req_medium:=coalesce((v_req#>>'{summary,mediumPriorityIssueCount}')::integer,0);

  v_state:=case
    when v_base_combined_high+v_req_high>0 then 'high_priority_continuity_attention'
    when v_base_combined_medium+v_req_medium>0 then 'continuity_attention'
    else 'no_actionable_continuity_gap_detected'
  end;

  return v_base||jsonb_build_object(
    'contractVersion','farm_continuity_audit_v10','state',v_state,
    'summary',coalesce(v_base->'summary','{}'::jsonb)||jsonb_build_object(
      'highPriorityIssueCount',v_base_high+v_req_high,
      'mediumPriorityIssueCount',v_base_medium+v_req_medium,
      'combinedHighPriorityIssueCount',v_base_combined_high+v_req_high,
      'combinedMediumPriorityIssueCount',v_base_combined_medium+v_req_medium,
      'requirementContinuityHighPriorityIssueCount',v_req_high,
      'requirementContinuityMediumPriorityIssueCount',v_req_medium,
      'requirementContinuityIssueCount',coalesce((v_req#>>'{summary,totalIssueCount}')::integer,0),
      'requirementDueWithoutExpressionCount',coalesce((v_req#>>'{summary,requirementDueWithoutExpressionCount}')::integer,0),
      'blockedExecutionWithoutLawfulContinuationCount',coalesce((v_req#>>'{summary,blockedExecutionWithoutLawfulContinuationCount}')::integer,0),
      'consequentialGapWithoutJurisdictionCount',coalesce((v_req#>>'{summary,consequentialGapWithoutJurisdictionCount}')::integer,0),
      'gapWithJurisdictionWithoutAcquisitionContinuationCount',coalesce((v_req#>>'{summary,gapWithJurisdictionWithoutAcquisitionContinuationCount}')::integer,0),
      'reconstructedLivingBodyExcludedFromProgressionCount',coalesce((v_req#>>'{summary,reconstructedLivingBodyExcludedFromProgressionCount}')::integer,0),
      'requirementClockResetCount',coalesce((v_req#>>'{summary,requirementClockResetCount}')::integer,0),
      'workerDayCardWithoutAvailableActionCount',coalesce((v_req#>>'{summary,workerDayCardWithoutAvailableActionCount}')::integer,0),
      'perfectHistoryDependencyCount',coalesce((v_req#>>'{summary,perfectHistoryDependencyCount}')::integer,0),
      'unresolvedDecisionHidesSourceConsequenceCount',coalesce((v_req#>>'{summary,unresolvedDecisionHidesSourceConsequenceCount}')::integer,0),
      'duplicateAcquisitionPathCount',coalesce((v_req#>>'{summary,duplicateAcquisitionPathCount}')::integer,0),
      'principalEscalationWithoutOwnershipMembraneCount',coalesce((v_req#>>'{summary,principalEscalationWithoutOwnershipMembraneCount}')::integer,0)
    ),
    'issueFamilies',coalesce(v_base->'issueFamilies','[]'::jsonb)||coalesce(v_req->'issueFamilies','[]'::jsonb),
    'requirementContinuity',v_req,
    'auditCoverage',coalesce(v_base->'auditCoverage','{}'::jsonb)||jsonb_build_object('requirementTruthAcquisitionExecution','requirement_continuity_audit_v1'),
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb)||jsonb_build_object(
      'requirementAuditedIndependentlyOfExecutionReadiness',true,
      'truthGapCausalityAudited',true,
      'requirementClockHistoryAudited',true,
      'workerDayActionabilityAudited',true,
      'principalOwnershipMembraneAudited',true
    ),
    'principalEscalationCreated',false
  );
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v10(uuid,date) from public,anon,authenticated;
grant execute on function atlas.farm_continuity_audit_v10(uuid,date) to service_role;

-- Compatibility wrapper: existing Atlas-wide callers continue calling v9 and receive vNext coverage.
create or replace function atlas.farm_continuity_audit_v9(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
begin
  return atlas.farm_continuity_audit_v10(p_farm_id,p_as_of_date);
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v9(uuid,date) from public,anon,authenticated;
grant execute on function atlas.farm_continuity_audit_v9(uuid,date) to authenticated,service_role;

comment on function atlas.requirement_continuity_audit_v1(uuid,date) is
'P7 Requirement → Truth Acquisition → Execution continuity auditor. Detects missing requirement expression, broken gap/acquisition causality, clock reset, non-actionable Worker Day cards, duplicate acquisition ownership, partial-history exclusion, hidden consequence, and false Principal escalation.';
comment on function atlas.farm_continuity_audit_v10(uuid,date) is
'P7 farm continuity auditor vNext: prior farm continuity plus explicit Requirement → Truth Acquisition → Execution continuity.';
comment on function atlas.farm_continuity_audit_v9(uuid,date) is
'Compatibility surface for farm continuity. Delegates to farm_continuity_audit_v10 so existing Atlas-wide callers receive P7 requirement continuity coverage.';
