-- Finished continuity API boundary.
-- Atlas exposes one product continuity contract. The three current proof functions are
-- explicit internal composition dependencies; historical version families are not part
-- of the boundary model and are handled by their own runtime-removal migrations.

do $migration$
declare
  v_helper text;
  v_helpers constant text[] := array[
    'atlas.farm_continuity_terminal_census_v2(uuid,date)',
    'atlas.requirement_continuity_audit_v2(uuid,date)',
    'atlas.operation_result_continuity_audit_v1(uuid,date)'
  ];
begin
  if to_regprocedure('atlas.atlas_wide_continuity_summary_v1(uuid,date)') is null then
    raise exception 'canonical Atlas-wide continuity API is missing';
  end if;

  foreach v_helper in array v_helpers loop
    if to_regprocedure(v_helper) is null then
      raise exception 'required continuity proof helper is missing: %', v_helper;
    end if;

    execute format('revoke execute on function %s from public, anon, authenticated', v_helper);
    execute format('grant execute on function %s to service_role', v_helper);
  end loop;

  -- The product boundary itself is explicit rather than inherited from whatever grants
  -- happened to survive earlier migrations.
  revoke execute on function atlas.atlas_wide_continuity_summary_v1(uuid,date) from public, anon;
  grant execute on function atlas.atlas_wide_continuity_summary_v1(uuid,date) to authenticated, service_role;

  update atlas.authenticated_rpc_registry
     set classification = 'service_internal',
         authenticated_execute_expected = false,
         anonymous_execute_expected = false,
         service_execute_expected = true,
         reviewed_at = now(),
         evidence = coalesce(evidence, '{}'::jsonb) || jsonb_build_object(
           'continuityApiBoundary', 'internal_composition_proof',
           'canonicalProductAuthority', 'atlas.atlas_wide_continuity_summary_v1',
           'boundaryRule', 'Only the Atlas-wide continuity summary is a product-facing continuity API; current proof functions are explicit service-internal dependencies.'
         )
   where signature in (
     'atlas.farm_continuity_terminal_census_v2(uuid, date)',
     'atlas.requirement_continuity_audit_v2(uuid, date)',
     'atlas.operation_result_continuity_audit_v1(uuid, date)'
   );
end;
$migration$;

comment on function atlas.atlas_wide_continuity_summary_v1(uuid,date) is
'Canonical product-facing Atlas continuity API. It composes exactly the current terminal census, Requirement Continuity, and Operation→Result continuity proofs; historical continuity versions are not product surfaces.';
