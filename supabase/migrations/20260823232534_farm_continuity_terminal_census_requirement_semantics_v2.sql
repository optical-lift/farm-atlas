-- Introduce Requirement Continuity v2 as the self-contained current authority.
-- Historical v1 is migration input only: its corrected governed body is promoted into
-- v2, the legacy progression diagnostic is removed from current continuity semantics,
-- and v1 is removed from the executable schema in the same architectural step.

do $migration$
declare
  v_def text;
  v_start integer;
  v_finish integer;
  v_old_predicate text := E'where ce.response_required\n      and not coalesce((ce.snapshot->>''profilePresent'')::boolean,false)\n      and not coalesce((ce.biological->>''applicable'')::boolean,false)';
  v_new_predicate text := E'where ce.response_required\n      and not ce.requirement_expressed\n      and not coalesce((ce.snapshot->>''profilePresent'')::boolean,false)\n      and not coalesce((ce.biological->>''applicable'')::boolean,false)';
  v_issue_start text := $issue$
    union all
    select 'reconstructed_living_body_excluded_from_progression'$issue$;
  v_next_issue text := $next$
    union all
    select 'requirement_clock_reset_detected'$next$;
begin
  select pg_get_functiondef(p.oid)
    into v_def
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='requirement_continuity_audit_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_as_of_date date';

  if v_def is null then
    raise exception 'requirement_continuity_audit_v1 migration input not found';
  end if;

  if position('worker_day_task_placements' in v_def)=0
     or position('task_execution_readiness_v1' in v_def)=0 then
    raise exception 'requirement_continuity_audit_v1 is not at the governed worker-actionability source state';
  end if;

  -- Absorb the branch-local reconstructed-body correction here instead of mutating v1
  -- in a standalone migration immediately before replacing it.
  if position(v_old_predicate in v_def)>0 then
    v_def := replace(v_def,v_old_predicate,v_new_predicate);
  elsif position(v_new_predicate in v_def)=0 then
    raise exception 'reconstructed-body predicate is not in a recognized governed state';
  end if;

  -- Promote the corrected implementation directly into v2. The resulting runtime body
  -- contains no v1 delegation.
  v_def := replace(v_def,'requirement_continuity_audit_v1','requirement_continuity_audit_v2');

  -- Legacy progression mismatch is lineage diagnostics, not current continuity work.
  v_start := strpos(v_def,v_issue_start);
  v_finish := strpos(v_def,v_next_issue);
  if v_start=0 or v_finish=0 or v_finish<=v_start then
    raise exception 'legacy progression diagnostic block not found during v2 introduction';
  end if;
  v_def := substr(v_def,1,v_start-1) || substr(v_def,v_finish);

  v_def := replace(
    v_def,
    $old$'auditDoesNotMutateDomainTruth',true
    )$old$,
    $new$'auditDoesNotMutateDomainTruth',true,
      'canonicalRequirementContinuityComputesCurrentPopulationDirectly',true,
      'supersededRequirementVersionsAreNotExecutionDependencies',true,
      'legacyProgressionDiagnosticsRemainMigrationHistoryOnly',true
    )$new$
  );

  execute v_def;

  revoke all on function atlas.requirement_continuity_audit_v2(uuid,date) from public,anon,authenticated;
  grant execute on function atlas.requirement_continuity_audit_v2(uuid,date) to service_role;

  delete from atlas.authenticated_rpc_registry
  where signature='atlas.requirement_continuity_audit_v1(uuid, date)';

  drop function atlas.requirement_continuity_audit_v1(uuid,date) restrict;
end
$migration$;

comment on function atlas.requirement_continuity_audit_v2(uuid,date) is
'Canonical self-contained Requirement → Truth Acquisition → Execution continuity proof. Historical v1 and legacy progression diagnostics remain migration provenance only, not executable current authority.';

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

revoke all on function atlas.farm_continuity_terminal_census_v2(uuid,date) from public, anon, authenticated;
grant execute on function atlas.farm_continuity_terminal_census_v2(uuid,date) to service_role;