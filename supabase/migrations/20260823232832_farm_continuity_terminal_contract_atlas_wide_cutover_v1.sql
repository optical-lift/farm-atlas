create or replace function atlas.farm_continuity_terminal_census_v1(
  p_farm_id uuid,
  p_as_of_date date default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, atlas, auth
as $function$
declare
  v_day date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_population_count integer := 0;
  v_classified_count integer := 0;
  v_uncovered_count integer := 0;
  v_duplicate_count integer := 0;
  v_work_count integer := 0;
  v_gate_count integer := 0;
  v_attention_count integer := 0;
  v_acquisition_count integer := 0;
  v_dwell_count integer := 0;
  v_bio_wait_count integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_uncovered jsonb := '[]'::jsonb;
  v_req jsonb;
  v_result jsonb;
  v_req_high integer := 0;
  v_req_medium integer := 0;
  v_result_high integer := 0;
  v_result_medium integer := 0;
  v_result_governed integer := 0;
  v_state text;
begin
  if p_farm_id is null then
    raise exception 'A farm is required.' using errcode='22023';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  with current_population as materialized (
    select cc.id, cc.crop_cycle_key, cc.crop_label, cc.variety, cc.cycle_state, cc.lifecycle_status
    from atlas.crop_cycles cc
    where cc.farm_id = p_farm_id
      and cc.lifecycle_status = 'active'
  ), evaluated as materialized (
    select cp.*, atlas.crop_cycle_reality_expression_v8(cp.id) as reality
    from current_population cp
  ), classified as materialized (
    select e.*,
           e.reality#>>'{continuity,state}' as continuity_state,
           coalesce((e.reality#>>'{continuity,silentNothing}')::boolean,true) as silent_nothing,
           case e.reality#>>'{continuity,state}'
             when 'linked_operation_present' then 'executable_or_released_work'
             when 'released_operation_present' then 'executable_or_released_work'
             when 'future_gate_present' then 'lawful_future_or_gated'
             when 'explicit_repair_or_inspection_required' then 'management_or_observation_attention'
             when 'explicit_source_repair_required' then 'acquisition_or_source_attention'
             when 'lawful_biological_wait_present' then 'lawful_dwell_or_wait'
             when 'lawful_dwell_present' then 'lawful_dwell_or_wait'
             else 'uncovered'
           end as disposition_class
    from evaluated e
  ), item_rows as (
    select jsonb_build_object(
      'subjectId',id,
      'subjectKind','crop_cycle',
      'cropCycleKey',crop_cycle_key,
      'cropLabel',crop_label,
      'variety',variety,
      'cycleState',cycle_state,
      'canonicalLifecycleStatus',lifecycle_status,
      'dispositionClass',disposition_class,
      'continuityState',continuity_state,
      'continuity',reality->'continuity'
    ) as item,
    *
    from classified
  )
  select
    count(*)::integer,
    count(*) filter(where disposition_class <> 'uncovered' and not silent_nothing)::integer,
    count(*) filter(where disposition_class='uncovered' or silent_nothing)::integer,
    count(*) filter(where disposition_class='executable_or_released_work')::integer,
    count(*) filter(where disposition_class='lawful_future_or_gated')::integer,
    count(*) filter(where disposition_class='management_or_observation_attention')::integer,
    count(*) filter(where disposition_class='acquisition_or_source_attention')::integer,
    count(*) filter(where continuity_state='lawful_dwell_present')::integer,
    count(*) filter(where continuity_state='lawful_biological_wait_present')::integer,
    coalesce(jsonb_agg(item order by crop_label,id),'[]'::jsonb),
    coalesce(jsonb_agg(item order by crop_label,id) filter(where disposition_class='uncovered' or silent_nothing),'[]'::jsonb)
  into v_population_count,v_classified_count,v_uncovered_count,
       v_work_count,v_gate_count,v_attention_count,v_acquisition_count,v_dwell_count,v_bio_wait_count,
       v_items,v_uncovered
  from item_rows;

  select count(*)::integer - count(distinct id)::integer
  into v_duplicate_count
  from atlas.crop_cycles
  where farm_id=p_farm_id and lifecycle_status='active';

  v_req := atlas.requirement_continuity_audit_v1(p_farm_id,v_day);
  v_result := atlas.operation_result_continuity_audit_v1(p_farm_id,v_day);
  v_req_high := coalesce((v_req#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_req_medium := coalesce((v_req#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_result_high := coalesce((v_result#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_result_medium := coalesce((v_result#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_result_governed := coalesce((v_result#>>'{summary,governedContextCount}')::integer,0);

  v_state := case
    when v_uncovered_count > 0 or v_duplicate_count > 0 then 'coverage_integrity_failure'
    when v_req_high + v_result_high > 0 then 'current_bodies_covered_with_actionable_continuity_work'
    when v_req_medium + v_result_medium > 0 then 'current_bodies_covered_with_continuity_attention'
    else 'current_state_continuity_sound'
  end;

  return jsonb_build_object(
    'contractVersion','farm_continuity_terminal_census_v2',
    'farmId',p_farm_id,
    'asOfDate',v_day,
    'state',v_state,
    'summary',jsonb_build_object(
      'activeCropCycleCount',v_population_count,
      'currentWorkCoveredCount',v_work_count,
      'futureGatedCoveredCount',v_gate_count,
      'managementOrObservationAttentionCount',v_attention_count,
      'acquisitionOrSourceAttentionCount',v_acquisition_count,
      'perennialLawfulDwellCount',v_dwell_count,
      'annualBiologicalWaitCount',v_bio_wait_count,
      'lawfulDwellOrWaitCount',v_dwell_count+v_bio_wait_count,
      'noLawfulNextStateCount',v_uncovered_count,
      'duplicateCurrentSubjectCount',v_duplicate_count,
      'highPriorityIssueCount',v_req_high+v_result_high,
      'mediumPriorityIssueCount',v_req_medium+v_result_medium,
      'combinedHighPriorityIssueCount',v_req_high+v_result_high,
      'combinedMediumPriorityIssueCount',v_req_medium+v_result_medium,
      'requirementContinuityHighPriorityIssueCount',v_req_high,
      'requirementContinuityMediumPriorityIssueCount',v_req_medium,
      'operationResultHighPriorityIssueCount',v_result_high,
      'operationResultMediumPriorityIssueCount',v_result_medium,
      'operationResultGovernedContextCount',v_result_governed,
      'spatialDestinationGovernedContinuationCount',0,
      'overclaimedAvailabilityCount',0,
      'destinationCollisionCount',0,
      'committedWorkWithoutLaborCapacityCount',0
    ),
    'theorem',jsonb_build_object(
      'statement','Every current living crop body has exactly one canonical present-tense continuity disposition.',
      'currentPopulationCount',v_population_count,
      'classifiedExactlyOnceCount',v_classified_count,
      'uncoveredCurrentSubjectCount',v_uncovered_count,
      'duplicateCurrentSubjectCount',v_duplicate_count,
      'proven',v_population_count=v_classified_count and v_uncovered_count=0 and v_duplicate_count=0
    ),
    'dispositionSummary',jsonb_build_object(
      'executableOrReleasedWorkCount',v_work_count,
      'lawfulFutureOrGatedCount',v_gate_count,
      'managementOrObservationAttentionCount',v_attention_count,
      'acquisitionOrSourceAttentionCount',v_acquisition_count,
      'lawfulDwellCount',v_dwell_count,
      'lawfulBiologicalWaitCount',v_bio_wait_count,
      'lawfulDwellOrWaitCount',v_dwell_count+v_bio_wait_count
    ),
    'currentSubjects',v_items,
    'coverageIntegrityFailures',v_uncovered,
    'issueFamilies',coalesce(v_req->'issueFamilies','[]'::jsonb)||coalesce(v_result->'issueFamilies','[]'::jsonb),
    'requirementContinuity',v_req,
    'operationResultContinuity',v_result,
    'truthBoundary',jsonb_build_object(
      'populationBuiltFromCurrentCanonicalCropCycles',true,
      'legacyAuditFindingsDoNotCreateCurrentSubjects',true,
      'historicalEvidenceMayExplainButNotAssertPresentExistence',true,
      'coverageAndOperationalizationAreDistinctProofs',true,
      'requirementOperationalizationAuditedIndependently',true,
      'operationResultContinuityAuditedIndependently',true,
      'legacyFarmClaimConflictAndCapacityFieldsAreNotPartOfThisTerminalCensus',true,
      'auditDoesNotMutateFarmTruth',true
    )
  );
end;
$function$;

revoke all on function atlas.farm_continuity_terminal_census_v1(uuid,date) from public;
grant execute on function atlas.farm_continuity_terminal_census_v1(uuid,date) to authenticated, service_role;

do $cutover$
declare
  v_def text;
  v_old text := 'v_farm:=atlas.farm_continuity_audit_v9(v_unit.linked_farm_id,p_day);';
  v_new text := 'v_farm:=atlas.farm_continuity_terminal_census_v1(v_unit.linked_farm_id,p_day);';
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='atlas_wide_continuity_summary_v1'
  limit 1;
  if v_def is null then raise exception 'atlas.atlas_wide_continuity_summary_v1 not found'; end if;
  if position(v_old in v_def)=0 then raise exception 'Expected legacy farm continuity composition call not found'; end if;
  v_def := replace(v_def,v_old,v_new);
  v_def := replace(v_def,'''atlas.farm_continuity_audit_v9''','''atlas.farm_continuity_terminal_census_v1''');
  execute v_def;
end
$cutover$;

insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
)
values(
  'atlas.farm_continuity_terminal_census_v1(uuid, date)',
  'policy_or_composition_helper','verified','active',
  true,true,true,1,1,
  jsonb_build_object(
    'purpose','Current-state terminal farm continuity census used by Atlas-wide continuity composition.',
    'populationAuthority','Current canonical atlas.crop_cycles with lifecycle_status=active.',
    'truthBoundary','Legacy audit findings may explain history but cannot create present-tense subjects.',
    'coverageSeparation','Current-body coverage is distinct from Requirement and Operation-Result operationalization audits.',
    'cutover','atlas_wide_continuity_summary_v1'
  ),now(),now(),false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at,
  anonymous_execute_expected=excluded.anonymous_execute_expected;