do $migration$
declare
  r record;
  v_identity text;
  v_signature text;
begin
  for r in
    select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as identity_args
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
      and (
        p.proname ~ '^farm_continuity_audit_v[0-9]+$'
        or p.proname ~ '^farm_continuity_terminal_census_v[0-9]+$'
        or p.proname ~ '^requirement_continuity_audit_v[0-9]+$'
        or p.proname ~ '^operation_result_continuity_audit_v[0-9]+$'
      )
  loop
    v_identity := format('atlas.%I(%s)', r.proname, r.identity_args);
    execute format('revoke execute on function %s from public, anon, authenticated', v_identity);
    execute format('grant execute on function %s to service_role', v_identity);

    v_signature := format('atlas.%s(%s)', r.proname, replace(r.identity_args, ', ', ', '));
    update atlas.authenticated_rpc_registry
       set classification = 'service_internal',
           authenticated_execute_expected = false,
           anonymous_execute_expected = false,
           service_execute_expected = true,
           reviewed_at = now(),
           evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
             'continuityApiBoundary', 'service_internal_helper',
             'canonicalProductAuthority', 'atlas.atlas_wide_continuity_summary_v1',
             'boundaryRule', 'Lower-level continuity proofs and diagnostics cannot serve as independent authenticated product APIs.'
           )
     where signature = v_signature;
  end loop;
end;
$migration$;

comment on function atlas.atlas_wide_continuity_summary_v1(uuid,date) is
'Canonical product-facing Atlas continuity API. Lower-level farm, requirement, operation-result, and historical continuity functions are service-internal composition or diagnostic helpers.';
