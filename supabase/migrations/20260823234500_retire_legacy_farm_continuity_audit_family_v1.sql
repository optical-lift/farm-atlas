-- Retire the historical farm_continuity_audit_vN family from the product-facing RPC surface.
-- These functions remain executable by service_role for lineage/diagnostics only.
-- Canonical current-state farm continuity authority is farm_continuity_terminal_census_v2,
-- consumed through atlas_wide_continuity_summary_v1.

do $migration$
declare
  r record;
  v_signature text;
begin
  for r in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
      and p.proname ~ '^farm_continuity_audit_v[0-9]+$'
    order by p.proname
  loop
    v_signature := r.oid::regprocedure::text;

    execute format('revoke execute on function %s from public, anon, authenticated', v_signature);
    execute format('grant execute on function %s to service_role', v_signature);

    update atlas.authenticated_rpc_registry
    set classification = 'service_internal',
        confidence = 'verified',
        review_status = 'active',
        authenticated_execute_expected = false,
        anonymous_execute_expected = false,
        service_execute_expected = true,
        evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
          'authority', 'atlas.farm_continuity_terminal_census_v2(uuid, date)',
          'status', 'historical_diagnostic_lineage_only',
          'truthBoundary', 'Legacy audit wrappers may explain historical diagnostics but cannot serve as present-tense farm continuity authority.'
        ),
        reviewed_at = now()
    where signature = 'atlas.' || v_signature;
  end loop;
end;
$migration$;
