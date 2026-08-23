create or replace function atlas.farm_continuity_terminal_census_v2(p_farm_id uuid, p_as_of_date date default null::date)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog', 'atlas', 'auth'
as $function$
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
  v_result_governed integer := 0;
  v_state text;
  v_summary jsonb;
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
  v_result_governed := coalesce((v_result#>>'{summary,governedContextCount}')::integer,0);

  v_state := case
    when not v_theorem_proven then 'coverage_integrity_failure'
    when v_req_high+v_result_high>0 then 'current_bodies_covered_with_actionable_continuity_work'
    when v_req_medium+v_result_medium>0 then 'current_bodies_covered_with_continuity_attention'
    else 'current_state_continuity_sound'
  end;

  v_summary := coalesce(v_base->'summary','{}'::jsonb) || jsonb_build_object(
    'highPriorityIssueCount',v_req_high+v_result_high,
    'mediumPriorityIssueCount',v_req_medium+v_result_medium,
    'combinedHighPriorityIssueCount',v_req_high+v_result_high,
    'combinedMediumPriorityIssueCount',v_req_medium+v_result_medium,
    'requirementContinuityHighPriorityIssueCount',v_req_high,
    'requirementContinuityMediumPriorityIssueCount',v_req_medium,
    'operationResultHighPriorityIssueCount',v_result_high,
    'operationResultMediumPriorityIssueCount',v_result_medium,
    'operationResultGovernedContextCount',v_result_governed
  );

  return v_base || jsonb_build_object(
    'contractVersion','farm_continuity_terminal_census_v2',
    'state',v_state,
    'summary',v_summary,
    'issueFamilies',coalesce(v_req->'issueFamilies','[]'::jsonb)||coalesce(v_result->'issueFamilies','[]'::jsonb),
    'requirementContinuity',v_req,
    'operationResultContinuity',v_result,
    'truthBoundary',coalesce(v_base->'truthBoundary','{}'::jsonb) || jsonb_build_object(
      'legacyModelCoverageDiagnosticsDoNotOverrideCurrentStateCoverageProof',true,
      'actionableContinuityAndDiagnosticLineageAreSeparate',true,
      'terminalSummaryAndIssueFamiliesUseCurrentV2RequirementSemantics',true
    )
  );
end;
$function$;

comment on function atlas.farm_continuity_terminal_census_v2(uuid,date) is
'Canonical production terminal continuity census. Current living crop-body theorem is inherited from the canonical population proof; actionable requirement continuity uses requirement_continuity_audit_v2 and operation-result continuity uses operation_result_continuity_audit_v1.';

comment on function atlas.farm_continuity_terminal_census_v1(uuid,date) is
'Superseded terminal continuity census retained as an internal lineage/base proof for v2. Not a public authenticated API.';

revoke execute on function atlas.farm_continuity_terminal_census_v1(uuid,date) from public, anon, authenticated;
grant execute on function atlas.farm_continuity_terminal_census_v1(uuid,date) to service_role;
revoke execute on function atlas.farm_continuity_terminal_census_v2(uuid,date) from public, anon, authenticated;
grant execute on function atlas.farm_continuity_terminal_census_v2(uuid,date) to service_role;

do $migration$
declare
  v_oid oid;
  v_def text;
  v_new text;
begin
  select p.oid into v_oid
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='atlas_wide_continuity_summary_v1'
    and pg_get_function_identity_arguments(p.oid)='p_principal_id uuid, p_day date';

  if v_oid is null then
    raise exception 'atlas.atlas_wide_continuity_summary_v1(uuid,date) not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position('farm_continuity_terminal_census_v1' in v_def)=0 then
    raise exception 'Expected v1 terminal census reference not found in atlas-wide continuity summary';
  end if;

  v_new := replace(v_def,'farm_continuity_terminal_census_v1','farm_continuity_terminal_census_v2');
  execute v_new;
end;
$migration$;

comment on function atlas.atlas_wide_continuity_summary_v1(uuid,date) is
'Atlas-wide continuity summary. Farm operating-unit continuity is routed through canonical farm_continuity_terminal_census_v2.';