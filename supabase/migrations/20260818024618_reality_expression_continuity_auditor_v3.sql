create or replace function atlas.farm_continuity_audit_v3(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_day date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_no_next_count integer := 0;
  v_missing_destination_count integer := 0;
  v_overclaimed_count integer := 0;
  v_destination_collision_count integer := 0;
  v_labor_capacity_count integer := 0;
  v_result_without_continuation_count integer := 0;
  v_orphaned_expected_stage_count integer := 0;
  v_no_next_items jsonb := '[]'::jsonb;
  v_missing_destination_items jsonb := '[]'::jsonb;
  v_overclaimed_items jsonb := '[]'::jsonb;
  v_destination_collision_items jsonb := '[]'::jsonb;
  v_labor_capacity_items jsonb := '[]'::jsonb;
  v_result_without_continuation_items jsonb := '[]'::jsonb;
  v_orphaned_expected_stage_items jsonb := '[]'::jsonb;
  v_high integer := 0;
  v_medium integer := 0;
  v_state text;
begin
  if p_farm_id is null then
    raise exception 'A farm is required.' using errcode='22023';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_base := atlas.farm_continuity_audit_v2(p_farm_id,v_day);

  -- 1. Current living subjects for which canonical Reality Expression has no lawful continuation.
  with packets as materialized (
    select cc.id,cc.crop_cycle_key,cc.crop_label,cc.variety,cc.cycle_state,cc.lifecycle_status,
           atlas.crop_cycle_reality_expression_v4(cc.id) as packet
    from atlas.crop_cycles cc
    where cc.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
  ), gaps as (
    select *
    from packets p
    where coalesce((p.packet #>> '{continuity,silentNothing}')::boolean,false)=true
      and exists (
        select 1
        from jsonb_array_elements(coalesce(p.packet->'issues','[]'::jsonb)) issue
        where issue->>'key'='living_subject_without_known_continuation'
      )
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'cropCycleId',id,
           'cropCycleKey',crop_cycle_key,
           'cropLabel',crop_label,
           'variety',variety,
           'cycleState',cycle_state,
           'lifecycleStatus',lifecycle_status,
           'continuity',packet->'continuity',
           'fittingOperation',packet->'fittingOperation',
           'repairOwner','farm_operations_continuity',
           'reason','A living subject is represented, but canonical Reality Expression has no lawful next state, gate, wait, inspection, or terminal classification.'
         )) order by crop_label,variety nulls last,id),'[]'::jsonb)
  into v_no_next_count,v_no_next_items
  from gaps;

  -- 2, 3 and 7. Production-lot destination, availability and expected-stage continuity.
  with packets as materialized (
    select pl.id,pl.stable_key,pl.lot_label,pl.current_stage,pl.lifecycle_status,
           pl.planned_sow_date,pl.expected_transplant_start,pl.expected_transplant_end,
           pl.expected_harvest_start,pl.expected_harvest_end,
           atlas.reality_expression_packet_v2(pl.id) as packet,
           case
             when pl.current_stage in ('planned','input_ready','ready_to_sow') then pl.planned_sow_date
             when pl.current_stage in ('sown','germinating','germinated','propagation','seedling','hardening_off') then pl.expected_transplant_start
             when pl.current_stage in ('transplanted','establishing','established','field','growing') then pl.expected_harvest_start
             when pl.current_stage in ('harvest','harvesting','harvest_ready') then pl.expected_harvest_end
             else null
           end as next_expected_date
    from atlas.production_lots pl
    where pl.farm_id=p_farm_id
      and coalesce(pl.lifecycle_status,'') not in ('cancelled','failed','complete','completed','archived','terminated')
  ), missing_destination as (
    select * from packets
    where coalesce(packet #>> '{flowBufferClaim,claims,destination,state}','unresolved')='unresolved'
  ), overclaimed as (
    select distinct p.*
    from packets p
    cross join lateral jsonb_array_elements(coalesce(p.packet #> '{flowBufferClaim,claims,seed,claimSets}','[]'::jsonb)) claim_set
    where coalesce(claim_set #>> '{collision,state}','')='established_overallocation'
       or coalesce((claim_set #>> '{collision,conflictEstablished}')::boolean,false)=true
  ), orphaned as (
    select * from packets
    where next_expected_date is not null
      and coalesce(packet #>> '{flowBufferClaim,nextTransitionAvailability,operationFunction}','') in ('','inspect','inspect_continuity')
  )
  select
    (select count(*)::integer from missing_destination),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'productionLotId',id,'stableKey',stable_key,'lotLabel',lot_label,'currentStage',current_stage,
       'lifecycleStatus',lifecycle_status,'plannedSowDate',planned_sow_date,
       'daysUntilSow',case when planned_sow_date is null then null else planned_sow_date-v_day end,
       'horizonClass',case
         when planned_sow_date is null then 'undated'
         when planned_sow_date < v_day then 'overdue'
         when planned_sow_date <= v_day+30 then 'within_30_days'
         else 'future_preparation'
       end,
       'destinationClaim',packet #> '{flowBufferClaim,claims,destination}',
       'nextTransitionAvailability',packet #> '{flowBufferClaim,nextTransitionAvailability}',
       'repairOwner','farm_operations_management',
       'reason','The Production subject has no canonical destination claim. Existence or a future date is not executable availability.'
     )) order by planned_sow_date nulls last,lot_label),'[]'::jsonb) from missing_destination),
    (select count(*)::integer from overclaimed),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'productionLotId',id,'stableKey',stable_key,'lotLabel',lot_label,'currentStage',current_stage,
       'seedClaims',packet #> '{flowBufferClaim,claims,seed}',
       'repairOwner','production_inventory',
       'reason','Trusted physical evidence establishes that claims exceed physical availability.'
     )) order by lot_label),'[]'::jsonb) from overclaimed),
    (select count(*)::integer from orphaned),
    (select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
       'productionLotId',id,'stableKey',stable_key,'lotLabel',lot_label,'currentStage',current_stage,
       'nextExpectedDate',next_expected_date,
       'nextTransitionAvailability',packet #> '{flowBufferClaim,nextTransitionAvailability}',
       'repairOwner','production_systems',
       'reason','A canonical expected next-stage date exists, but no lawful fitting operation, preparation step, wait state, or continuation is represented.'
     )) order by next_expected_date,lot_label),'[]'::jsonb) from orphaned)
  into v_missing_destination_count,v_missing_destination_items,
       v_overclaimed_count,v_overclaimed_items,
       v_orphaned_expected_stage_count,v_orphaned_expected_stage_items;

  -- 4. Destination collision requires explicit overlapping placement evidence, not merely shared-object ambiguity.
  with active_placements as materialized (
    select cp.id as placement_id,cp.object_id,cp.crop_cycle_id,cp.placement_key,
           cp.long_start_ft,cp.long_end_ft,cp.cross_start_ft,cp.cross_end_ft,
           cc.crop_label,cc.variety,cc.cycle_state,go.label as object_label
    from atlas.crop_placements cp
    join atlas.crop_cycles cc on cc.id=cp.crop_cycle_id
    left join atlas.growing_objects go on go.id=cp.object_id
    where cp.farm_id=p_farm_id
      and coalesce(cc.lifecycle_status,'active')='active'
  ), cell_pairs as (
    select least(a.crop_cycle_id,b.crop_cycle_id) as cycle_a,
           greatest(a.crop_cycle_id,b.crop_cycle_id) as cycle_b,
           a.object_id,
           'shared_explicit_cell'::text as evidence_type,
           min(ca.cell_key) as evidence_key
    from active_placements a
    join atlas.crop_placement_cells ca on ca.placement_id=a.placement_id
    join active_placements b on b.object_id=a.object_id and b.crop_cycle_id<>a.crop_cycle_id
    join atlas.crop_placement_cells cb on cb.placement_id=b.placement_id and cb.cell_key=ca.cell_key
    where a.crop_cycle_id<b.crop_cycle_id
    group by least(a.crop_cycle_id,b.crop_cycle_id),greatest(a.crop_cycle_id,b.crop_cycle_id),a.object_id
  ), rectangle_pairs as (
    select least(a.crop_cycle_id,b.crop_cycle_id) as cycle_a,
           greatest(a.crop_cycle_id,b.crop_cycle_id) as cycle_b,
           a.object_id,
           'overlapping_explicit_rectangle'::text as evidence_type,
           null::text as evidence_key
    from active_placements a
    join active_placements b on b.object_id=a.object_id and a.crop_cycle_id<b.crop_cycle_id
    where a.long_start_ft is not null and a.long_end_ft is not null
      and a.cross_start_ft is not null and a.cross_end_ft is not null
      and b.long_start_ft is not null and b.long_end_ft is not null
      and b.cross_start_ft is not null and b.cross_end_ft is not null
      and least(a.long_end_ft,b.long_end_ft)>greatest(a.long_start_ft,b.long_start_ft)
      and least(a.cross_end_ft,b.cross_end_ft)>greatest(a.cross_start_ft,b.cross_start_ft)
  ), raw_pairs as (
    select * from cell_pairs
    union all
    select * from rectangle_pairs
  ), collisions as (
    select r.cycle_a,r.cycle_b,r.object_id,
           jsonb_agg(distinct to_jsonb(r.evidence_type)) as evidence_types,
           jsonb_agg(distinct to_jsonb(r.evidence_key)) filter(where r.evidence_key is not null) as evidence_keys,
           max(a.crop_label) filter(where a.crop_cycle_id=r.cycle_a) as crop_a_label,
           max(a.variety) filter(where a.crop_cycle_id=r.cycle_a) as crop_a_variety,
           max(b.crop_label) filter(where b.crop_cycle_id=r.cycle_b) as crop_b_label,
           max(b.variety) filter(where b.crop_cycle_id=r.cycle_b) as crop_b_variety,
           max(coalesce(a.object_label,b.object_label)) as object_label
    from raw_pairs r
    left join active_placements a on a.crop_cycle_id=r.cycle_a and a.object_id=r.object_id
    left join active_placements b on b.crop_cycle_id=r.cycle_b and b.object_id=r.object_id
    group by r.cycle_a,r.cycle_b,r.object_id
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'cropCycleA',cycle_a,'cropALabel',crop_a_label,'cropAVariety',crop_a_variety,
           'cropCycleB',cycle_b,'cropBLabel',crop_b_label,'cropBVariety',crop_b_variety,
           'objectId',object_id,'objectLabel',object_label,
           'evidenceTypes',evidence_types,'evidenceKeys',evidence_keys,
           'repairOwner','farm_operations_management',
           'reason','Two active crop bodies have explicit overlapping spatial evidence on the same growing object.'
         )) order by object_label,crop_a_label,crop_b_label),'[]'::jsonb)
  into v_destination_collision_count,v_destination_collision_items
  from collisions;

  -- 5. Labor-capacity collision requires an actual Worker Day claim and a proven day-capacity contradiction.
  with placement_groups as materialized (
    select p.membership_id,p.service_date,
           sum(coalesce(p.planned_duration_minutes,0))::integer as planned_minutes,
           count(*)::integer as placed_task_count,
           jsonb_agg(jsonb_build_object(
             'placementId',p.id,'taskId',p.task_id,'minutes',p.planned_duration_minutes,
             'dayWindow',p.day_window,'plannedStartAt',p.planned_start_at
           ) order by p.sort_order,p.created_at) as placements
    from atlas.worker_day_task_placements p
    where p.farm_id=p_farm_id
      and p.state='placed'
      and p.service_date between v_day and v_day+30
      and (
        exists(select 1 from atlas.task_crop_cycles tc where tc.task_id=p.task_id)
        or exists(select 1 from atlas.production_lot_tasks plt where plt.task_id=p.task_id)
      )
    group by p.membership_id,p.service_date
  ), evaluated as materialized (
    select g.*,atlas.worker_week_day_capacity_v1(p_farm_id,g.membership_id,g.service_date) as capacity
    from placement_groups g
  ), conflicts as (
    select * from evaluated
    where capacity->>'state' in ('unavailable','non_working_day','policy_conflict')
       or (nullif(capacity->>'maximumUsableMinutes','') is not null
           and planned_minutes>(capacity->>'maximumUsableMinutes')::integer)
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'membershipId',membership_id,'serviceDate',service_date,
           'plannedMinutes',planned_minutes,'placedTaskCount',placed_task_count,
           'capacity',capacity,'placements',placements,
           'repairOwner','farm_operations_management',
           'reason','Committed Worker Day production work exceeds or contradicts the canonical capacity contract for that worker/date.'
         )) order by service_date,membership_id),'[]'::jsonb)
  into v_labor_capacity_count,v_labor_capacity_items
  from conflicts;

  -- 6. A recorded operation fruit must not leave its living subject with silent nothing afterward.
  with latest_actual as materialized (
    select distinct on (link.crop_cycle_id)
           link.crop_cycle_id,a.id as operation_actual_id,a.task_id,a.operation_class,a.observed_date,
           a.result_class,a.result_payload,a.created_at
    from atlas.production_operation_actual_crop_cycles link
    join atlas.production_operation_actuals a on a.id=link.operation_actual_id
    where a.farm_id=p_farm_id
    order by link.crop_cycle_id,a.created_at desc,a.id desc
  ), evaluated as (
    select la.*,cc.crop_label,cc.variety,cc.cycle_state,cc.lifecycle_status,
           atlas.crop_cycle_reality_expression_v4(la.crop_cycle_id) as packet
    from latest_actual la
    join atlas.crop_cycles cc on cc.id=la.crop_cycle_id
    where coalesce(cc.lifecycle_status,'active')='active'
  ), gaps as (
    select * from evaluated
    where coalesce((packet #>> '{continuity,silentNothing}')::boolean,false)=true
  )
  select count(*)::integer,
         coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
           'operationActualId',operation_actual_id,'taskId',task_id,'cropCycleId',crop_cycle_id,
           'cropLabel',crop_label,'variety',variety,'cycleState',cycle_state,
           'operationClass',operation_class,'observedDate',observed_date,'resultClass',result_class,
           'continuity',packet->'continuity',
           'repairOwner','farm_operations_continuity',
           'reason','Structured operation fruit exists, but the living subject currently has no represented continuation.'
         )) order by observed_date,crop_label,variety nulls last),'[]'::jsonb)
  into v_result_without_continuation_count,v_result_without_continuation_items
  from gaps;

  v_high := coalesce((v_base->'summary'->>'highPriorityIssueCount')::integer,0)
            + v_no_next_count + v_overclaimed_count + v_destination_collision_count
            + v_labor_capacity_count + v_result_without_continuation_count;
  v_medium := coalesce((v_base->'summary'->>'mediumPriorityIssueCount')::integer,0)
              + v_missing_destination_count + v_orphaned_expected_stage_count;
  v_state := case
    when v_high>0 then 'high_priority_continuity_attention'
    when v_medium>0 then 'continuity_attention'
    else 'no_actionable_continuity_gap_detected'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','farm_continuity_audit_v3',
    'state',v_state,
    'farmTruthMutated',false,
    'principalEscalationCreated',false,
    'principalBoundary','Continuity findings remain Farm Operations truth until an explicit escalation threshold translates them into an ownership decision.',
    'summary',(v_base->'summary') || jsonb_build_object(
      'highPriorityIssueCount',v_high,
      'mediumPriorityIssueCount',v_medium,
      'noLawfulNextStateCount',v_no_next_count,
      'missingDestinationCount',v_missing_destination_count,
      'overclaimedAvailabilityCount',v_overclaimed_count,
      'destinationCollisionCount',v_destination_collision_count,
      'committedWorkWithoutLaborCapacityCount',v_labor_capacity_count,
      'resultWithoutContinuationCount',v_result_without_continuation_count,
      'orphanedExpectedNextStageCount',v_orphaned_expected_stage_count
    ),
    'issueFamilies',(v_base->'issueFamilies') || jsonb_build_array(
      jsonb_build_object('key','no_lawful_next_state','severity','high','count',v_no_next_count,'items',v_no_next_items),
      jsonb_build_object('key','missing_destination','severity','medium','count',v_missing_destination_count,'items',v_missing_destination_items),
      jsonb_build_object('key','overclaimed_availability','severity','high','count',v_overclaimed_count,'items',v_overclaimed_items),
      jsonb_build_object('key','destination_collision','severity','high','count',v_destination_collision_count,'items',v_destination_collision_items),
      jsonb_build_object('key','committed_work_without_labor_capacity','severity','high','count',v_labor_capacity_count,'items',v_labor_capacity_items),
      jsonb_build_object('key','result_without_continuation','severity','high','count',v_result_without_continuation_count,'items',v_result_without_continuation_items),
      jsonb_build_object('key','orphaned_expected_next_stage','severity','medium','count',v_orphaned_expected_stage_count,'items',v_orphaned_expected_stage_items)
    ),
    'auditCoverage',(v_base->'auditCoverage') || jsonb_build_object(
      'realityExpressionNoLawfulNextState','audited_from_crop_cycle_reality_expression_v4',
      'realityExpressionMissingDestination','audited_from_production_flow_buffer_claim_v1',
      'realityExpressionOverclaimedAvailability','audited_only_when_trusted_physical_warrant_establishes_overallocation',
      'realityExpressionDestinationCollision','audited_only_from_explicit_overlapping_crop placement geometry_or_cells',
      'realityExpressionCommittedLaborCapacity','audited_from_worker_day_placement_claims_against_worker_week_day_capacity_v1',
      'realityExpressionResultContinuation','audited_from_structured_operation_actual_to_current_crop_continuity',
      'realityExpressionExpectedNextStage','audited_from_expected_production_milestones_without_a_lawful_operation_or_gate'
    ),
    'truthBoundary',jsonb_build_object(
      'unresolvedRelationIsNotCollision',true,
      'sharedClaimsWithoutTrustedPhysicalWarrantAreNotOverclaimed',true,
      'laborEstimateIsNotLaborClaim',true,
      'futureDateIsNotExecutableOperation',true,
      'taskCompletionIsNotContinuationProof',true,
      'auditDoesNotCreatePrincipalWork',true
    )
  );
end;
$function$;

revoke all on function atlas.farm_continuity_audit_v3(uuid,date) from public;
revoke all on function atlas.farm_continuity_audit_v3(uuid,date) from anon;
grant execute on function atlas.farm_continuity_audit_v3(uuid,date) to authenticated;
grant execute on function atlas.farm_continuity_audit_v3(uuid,date) to service_role;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.farm_continuity_audit_v3(uuid, date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Expose Farm Operations continuity truth through Reality Expression v3 without mutating farm truth or creating Principal work.',
    'boundary','Any active farm member may read the farm continuity audit; the function performs an explicit membership check before composing internal continuity and Reality Expression contracts.',
    'principalBoundary','Continuity findings remain Farm Operations truth until an explicit escalation threshold translates them into an ownership decision.'
  ),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
