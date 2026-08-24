insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected,
  service_execute_expected, caller_count, policy_reference_count,
  evidence, anonymous_execute_expected
)
values (
  'atlas.assert_architecture_authority_boundaries_v1()',
  'service_internal',
  'verified',
  'revoked',
  false,
  true,
  true,
  0,
  0,
  jsonb_build_object(
    'source','principal_owner_authority_reduction_v1',
    'boundary','CI/release assertion for Principal-time authority; not an application RPC.',
    'authorityOwner','principal_clock',
    'legacySurfaceRetired','atlas.owner_weekly_farm_contract_api_v1(uuid,uuid,date)'
  ),
  false
)
on conflict (signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected;
