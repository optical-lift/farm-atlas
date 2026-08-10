begin;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.worker_record_transplant_readiness_v1(uuid,text,integer,text,text)',
  'app_endpoint', 'verified', 'active', true, true, true, 1, 2,
  jsonb_build_object(
    'source','atlas_transplant_readiness_rpc_registry_reconcile_v1',
    'call_site','Transplant-readiness crop result card',
    'authorization','assigned farm hand or manager on task farm',
    'reviewed_date','2026-08-10'
  ), now(), now()
),
(
  'atlas.owner_operator_record_transplant_readiness_v1(uuid,uuid,text,integer,text,text)',
  'owner_admin_endpoint', 'verified', 'active', true, true, true, 1, 2,
  jsonb_build_object(
    'source','atlas_transplant_readiness_rpc_registry_reconcile_v1',
    'call_site','Owner operating through selected worker context',
    'authorization','owner operator context with effective membership visibility',
    'reviewed_date','2026-08-10'
  ), now(), now()
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
