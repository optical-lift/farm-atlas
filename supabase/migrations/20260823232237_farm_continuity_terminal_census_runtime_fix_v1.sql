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
  v_wait_count integer := 0;
  v_items jsonb := '[]'::jsonb;
  v_uncovered jsonb := '[]'::jsonb;
  v_req jsonb;
  v_result jsonb;
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
    count(*) filter(where disposition_class='lawful_dwell_or_wait')::integer,
    coalesce(jsonb_agg(item order by crop_label,id),'[]'::jsonb),
    coalesce(jsonb_agg(item order by crop_label,id) filter(where disposition_class='uncovered' or silent_nothing),'[]'::jsonb)
  into v_population_count,v_classified_count,v_uncovered_count,
       v_work_count,v_gate_count,v_attention_count,v_acquisition_count,v_wait_count,
       v_items,v_uncovered
  from item_rows;

  select count(*)::integer - count(distinct id)::integer
  into v_duplicate_count
  from atlas.crop_cycles
  where farm_id=p_farm_id and lifecycle_status='active';

  v_req := atlas.requirement_continuity_audit_v1(p_farm_id,v_day);
  v_result := atlas.operation_result_continuity_audit_v1(p_farm_id,v_day);

  v_state := case
    when v_uncovered_count > 0 or v_duplicate_count > 0 then 'coverage_integrity_failure'
    when coalesce((v_req#>>'{summary,highPriorityIssueCount}')::integer,0) > 0
      or coalesce((v_result#>>'{summary,highPriorityIssueCount}')::integer,0) > 0 then 'current_bodies_covered_with_actionable_continuity_work'
    when coalesce((v_req#>>'{summary,mediumPriorityIssueCount}')::integer,0) > 0
      or coalesce((v_result#>>'{summary,mediumPriorityIssueCount}')::integer,0) > 0 then 'current_bodies_covered_with_continuity_attention'
    else 'current_state_continuity_sound'
  end;

  return jsonb_build_object(
    'contractVersion','farm_continuity_terminal_census_v1',
    'farmId',p_farm_id,
    'asOfDate',v_day,
    'state',v_state,
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
      'lawfulDwellOrWaitCount',v_wait_count
    ),
    'currentSubjects',v_items,
    'coverageIntegrityFailures',v_uncovered,
    'requirementContinuity',v_req,
    'operationResultContinuity',v_result,
    'truthBoundary',jsonb_build_object(
      'populationBuiltFromCurrentCanonicalCropCycles',true,
      'legacyAuditFindingsDoNotCreateCurrentSubjects',true,
      'historicalEvidenceMayExplainButNotAssertPresentExistence',true,
      'coverageAndOperationalizationAreDistinctProofs',true,
      'requirementOperationalizationAuditedIndependently',true,
      'operationResultContinuityAuditedIndependently',true,
      'auditDoesNotMutateFarmTruth',true
    )
  );
end;
$function$;
