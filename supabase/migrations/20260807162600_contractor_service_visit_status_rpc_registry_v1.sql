begin;

insert into atlas.authenticated_rpc_registry(
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  registered_at,
  reviewed_at
) values (
  'atlas.record_contractor_service_visit_v1(uuid,date,uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  2,
  jsonb_build_object(
    'source','contractor_service_visit_status_rpc_registry_v1',
    'call_site','Master Trimmers contractor service status card',
    'authorization','assigned worker or owner/manager with active membership on task farm',
    'reviewed_date','2026-08-07'
  ),
  now(),
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
    evidence = coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb) || excluded.evidence,
    reviewed_at = excluded.reviewed_at;

commit;
