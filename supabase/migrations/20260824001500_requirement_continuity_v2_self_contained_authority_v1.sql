-- Finished-software convergence for Requirement Continuity.
-- Historical v1 is used only as migration input so its already-governed semantics are
-- promoted into v2. The finished executable schema does not retain a v2 -> v1 runtime
-- dependency, and v1 is removed after promotion.
--
-- The historical reconstructed-progression mismatch family is also removed from the
-- present-tense continuity authority. That family existed to diagnose legacy model
-- coverage; it must not manufacture current continuity work in the finished system.

do $migration$
declare
  v_def text;
  v_start integer;
  v_finish integer;
  v_issue_start text := E"    union all\n    select 'reconstructed_living_body_excluded_from_progression'";
  v_next_issue text := E"    union all\n    select 'requirement_clock_reset_detected'";
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

  -- Fail closed unless all later corrections to v1 are already present. We promote the
  -- corrected implementation, never an earlier historical form.
  if position('worker_day_task_placements' in v_def)=0
     or position('task_execution_readiness_v1' in v_def)=0
     or position('and not ce.requirement_expressed' in v_def)=0 then
    raise exception 'requirement_continuity_audit_v1 is not at the corrected governed source state';
  end if;

  -- Promote the corrected body into the canonical v2 function. This is a migration-time
  -- source promotion only; the resulting v2 function body contains no v1 call.
  v_def := replace(v_def,'requirement_continuity_audit_v1','requirement_continuity_audit_v2');

  -- Remove the legacy progression diagnostic from the current issue population. Its
  -- history remains in migrations, but it is no longer part of the finished authority.
  v_start := strpos(v_def,v_issue_start);
  v_finish := strpos(v_def,v_next_issue);
  if v_start=0 or v_finish=0 or v_finish<=v_start then
    raise exception 'legacy progression diagnostic block not found during v2 convergence';
  end if;
  v_def := substr(v_def,1,v_start-1) || substr(v_def,v_finish);

  -- Mark the finished authority boundary in the returned contract without introducing
  -- another wrapper version.
  v_def := replace(
    v_def,
    E"'auditDoesNotMutateDomainTruth',true\n    )",
    E"'auditDoesNotMutateDomainTruth',true,\n      'canonicalRequirementContinuityComputesCurrentPopulationDirectly',true,\n      'supersededRequirementVersionsAreNotExecutionDependencies',true,\n      'legacyProgressionDiagnosticsRemainMigrationHistoryOnly',true\n    )"
  );

  execute v_def;

  revoke all on function atlas.requirement_continuity_audit_v2(uuid,date) from public,anon,authenticated;
  grant execute on function atlas.requirement_continuity_audit_v2(uuid,date) to service_role;

  update atlas.authenticated_rpc_registry
  set classification='service_internal',
      confidence='verified',
      review_status='active',
      authenticated_execute_expected=false,
      anonymous_execute_expected=false,
      service_execute_expected=true,
      evidence=coalesce(evidence,'{}'::jsonb) || jsonb_build_object(
        'authority','atlas.requirement_continuity_audit_v2(uuid, date)',
        'status','self_contained_current_authority',
        'truthBoundary','Requirement Continuity v2 computes the governed current requirement population directly and does not delegate to a superseded requirement auditor.'
      ),
      reviewed_at=now()
  where signature='atlas.requirement_continuity_audit_v2(uuid, date)';

  delete from atlas.authenticated_rpc_registry
  where signature='atlas.requirement_continuity_audit_v1(uuid, date)';

  drop function atlas.requirement_continuity_audit_v1(uuid,date) restrict;
end
$migration$;

comment on function atlas.requirement_continuity_audit_v2(uuid,date) is
'Canonical self-contained Requirement → Truth Acquisition → Execution continuity proof. Historical v1 and legacy progression diagnostics remain migration provenance only, not executable current authority.';
