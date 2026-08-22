-- Register the only signed-in identity review apertures.
-- Both remain Principal/organization-owner endpoints; no direct local_intel mutation or merge execution is exposed.

revoke execute on function atlas.entity_identity_review_queue_api_v1() from public, anon;
revoke execute on function atlas.entity_identity_adjudicate_api_v1(jsonb) from public, anon;
grant execute on function atlas.entity_identity_review_queue_api_v1() to authenticated, service_role;
grant execute on function atlas.entity_identity_adjudicate_api_v1(jsonb) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at,
  anonymous_execute_expected
)
values
  (
    'atlas.entity_identity_review_queue_api_v1()',
    'owner_admin_endpoint',
    'verified',
    'active',
    true,
    true,
    true,
    1,
    0,
    jsonb_build_object(
      'purpose','Read the governed identity review queue for a signed-in Principal organization owner.',
      'caller','GET/server render /principal/resolve/entity-identity',
      'authorizationBoundary','Function derives auth.uid(), requires an active Principal and active organization owner membership, and exposes only local_intel.v_entity_identity_review_queue_v2.',
      'rawMutationExposed',false,
      'canonicalMergeExecutionAvailable',false,
      'contractVersion','entity_identity_review_v1'
    ),
    now(),
    now(),
    false
  ),
  (
    'atlas.entity_identity_adjudicate_api_v1(jsonb)',
    'owner_admin_endpoint',
    'verified',
    'active',
    true,
    true,
    true,
    1,
    0,
    jsonb_build_object(
      'purpose','Record one governed human identity adjudication from the Principal review workspace.',
      'caller','POST /api/atlas/entity-identity-review',
      'authorizationBoundary','Function derives auth.uid() and reviewer provenance, requires an active Principal and active organization owner membership, re-reads the pending queue item, and delegates only to governed local_intel adjudication functions.',
      'browserCanChooseTargetEntity',false,
      'canonicalMergeExecutionAvailable',false,
      'contractVersion','entity_identity_review_v1'
    ),
    now(),
    now(),
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
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();
