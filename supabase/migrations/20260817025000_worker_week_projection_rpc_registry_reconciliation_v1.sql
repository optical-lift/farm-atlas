begin;

-- The canonical Worker Week refresh was introduced by the Owner->Worker projection
-- cutover. Preserve its authenticated worker/owner-manager boundary in the fail-closed
-- RPC registry, and relabel the old Owner-named entry as compatibility-only.
revoke all on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer)
  from public, anon;
grant execute on function atlas.refresh_worker_week_projection_v1(uuid,uuid,date,integer)
  to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.refresh_worker_week_projection_v1(uuid, uuid, date, integer)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Canonical Worker week projection refresh',
    'boundary','Target worker may refresh self; active farm owner/manager may refresh the target worker',
    'principalTruth','Worker execution support only; creates no Principal scheduling truth'
  ),
  now()
),
(
  'atlas.refresh_owner_week_projection_v1(uuid, uuid, date, integer)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Legacy compatibility shim for canonical Worker week projection refresh',
    'boundary','Delegates to refresh_worker_week_projection_v1 under the same worker/owner-manager authorization contract',
    'principalTruth','Compatibility name only; not Principal scheduling truth'
  ),
  now()
)
on conflict (signature) do update
set classification = excluded.classification,
    confidence = excluded.confidence,
    review_status = excluded.review_status,
    authenticated_execute_expected = excluded.authenticated_execute_expected,
    security_definer_expected = excluded.security_definer_expected,
    service_execute_expected = excluded.service_execute_expected,
    caller_count = excluded.caller_count,
    policy_reference_count = excluded.policy_reference_count,
    evidence = excluded.evidence,
    reviewed_at = excluded.reviewed_at;

commit;
