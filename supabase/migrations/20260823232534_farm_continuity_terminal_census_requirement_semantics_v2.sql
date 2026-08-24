create or replace function atlas.requirement_continuity_audit_v2(
  p_farm_id uuid,
  p_as_of_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_base jsonb;
  v_day date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_diag_family jsonb := '{}'::jsonb;
  v_actionable_families jsonb := '[]'::jsonb;
  v_diag_count integer := 0;
  v_old_total integer := 0;
  v_old_medium integer := 0;
  v_new_total integer := 0;
  v_new_medium integer := 0;
  v_high integer := 0;
  v_state text;
begin
  if p_farm_id is null then
    raise exception 'A farm is required.' using errcode='22023';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_base := atlas.requirement_continuity_audit_v1(p_farm_id,v_day);

  select coalesce(f,'{}'::jsonb)
  into v_diag_family
  from jsonb_array_elements(coalesce(v_base->'issueFamilies','[]'::jsonb)) f
  where f->>'key'='reconstructed_living_body_excluded_from_progression'
  limit 1;

  v_diag_count := coalesce((v_diag_family->>'count')::integer,0);

  select coalesce(jsonb_agg(f order by ord),'[]'::jsonb)
  into v_actionable_families
  from jsonb_array_elements(coalesce(v_base->'issueFamilies','[]'::jsonb)) with ordinality x(f,ord)
  where f->>'key'<>'reconstructed_living_body_excluded_from_progression';

  v_old_total := coalesce((v_base#>>'{summary,totalIssueCount}')::integer,0);
  v_old_medium := coalesce((v_base#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_high := coalesce((v_base#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_new_total := greatest(0,v_old_total-v_diag_count);
  v_new_medium := greatest(0,v_old_medium-v_diag_count);

  v_state := case
    when v_high>0 then 'requirement_continuity_repair_required'
    when v_new_medium>0 then 'requirement_continuity_attention'
    else 'requirement_continuity_sound'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','requirement_continuity_audit_v2',
    'state',v_state,
    'summary',coalesce(v_base->'summary','{}'::jsonb) || jsonb_build_object(
      'totalIssueCount',v_new_total,
      'mediumPriorityIssueCount',v_new_medium,
      'reconstructedLivingBodyExcludedFromProgressionCount',0,
      'legacyProgressionCoverageDiagnosticCount',v_diag_count
    ),
    'issueFamilies',v_actionable_families,
    'diagnostics',jsonb_build_object(
      'legacyProgressionCoverage',case when v_diag_count>0 then jsonb_build_array(v_diag_family) else '[]'::jsonb end
    ),
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb) || jsonb_build_object(
      'legacyProgressionNonApplicabilityDoesNotCreateContinuityFailureWhenCurrentRequirementIsExpressed',true,
      'legacyModelCoverageMismatchRemainsVisibleAsDiagnostic',true
    )
  );
end;
$$;

create or replace function atlas.farm_continuity_terminal_census_v2(
  p_farm_id uuid,
  p_as_of_date date default null::date
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_day date := coalesce(p_as_of_date,(now() at time zone 'America/Chicago')::date);
  v_base jsonb;
  v_req jsonb;
  v_result jsonb;
  v_theorem_proven boolean := false;
  v_req_high integer := 0;
  v_req_medium integer := 0;
  v_result_high integer := 0;
  v_result_medium integer := 0;
  v_state text;
begin
  if p_farm_id is null then
    raise exception 'A farm is required.' using errcode='22023';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_base := atlas.farm_continuity_terminal_census_v1(p_farm_id,v_day);
  v_req := atlas.requirement_continuity_audit_v2(p_farm_id,v_day);
  v_result := atlas.operation_result_continuity_audit_v1(p_farm_id,v_day);

  v_theorem_proven := coalesce((v_base#>>'{theorem,proven}')::boolean,false);
  v_req_high := coalesce((v_req#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_req_medium := coalesce((v_req#>>'{summary,mediumPriorityIssueCount}')::integer,0);
  v_result_high := coalesce((v_result#>>'{summary,highPriorityIssueCount}')::integer,0);
  v_result_medium := coalesce((v_result#>>'{summary,mediumPriorityIssueCount}')::integer,0);

  v_state := case
    when not v_theorem_proven then 'coverage_integrity_failure'
    when v_req_high+v_result_high>0 then 'current_bodies_covered_with_actionable_continuity_work'
    when v_req_medium+v_result_medium>0 then 'current_bodies_covered_with_continuity_attention'
    else 'current_state_continuity_sound'
  end;

  return v_base || jsonb_build_object(
    'contractVersion','farm_continuity_terminal_census_v2',
    'state',v_state,
    'requirementContinuity',v_req,
    'operationResultContinuity',v_result,
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb) || jsonb_build_object(
      'legacyModelCoverageDiagnosticsDoNotOverrideCurrentStateCoverageProof',true,
      'actionableContinuityAndDiagnosticLineageAreSeparate',true
    )
  );
end;
$$;

revoke all on function atlas.requirement_continuity_audit_v2(uuid,date) from public, anon, authenticated;
revoke all on function atlas.farm_continuity_terminal_census_v2(uuid,date) from public, anon, authenticated;
grant execute on function atlas.requirement_continuity_audit_v2(uuid,date) to service_role;
grant execute on function atlas.farm_continuity_terminal_census_v2(uuid,date) to service_role;