insert into atlas.authenticated_rpc_registry (
  signature,
  classification,
  confidence,
  review_status,
  authenticated_execute_expected,
  anonymous_execute_expected,
  security_definer_expected,
  service_execute_expected,
  caller_count,
  policy_reference_count,
  evidence,
  reviewed_at
)
values (
  'atlas.source_custody_release_packet_v1()',
  'public_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','read-only Atlas source-custody release packet for CI and release verification',
    'exposesOperationalBusinessRows',false,
    'exposesMigrationSqlBodies',false,
    'publicDataClass','schema fingerprints, migration names/versions/blob hashes, accepted custody adjudication metadata'
  ),
  now()
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  anonymous_execute_expected = excluded.anonymous_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  reviewed_at = excluded.reviewed_at;