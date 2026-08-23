-- Freeze the live authenticated RPC registry state for the generic structured-result contract.
-- The preceding contract migration grants authenticated EXECUTE to exactly these two app endpoints.

insert into atlas.authenticated_rpc_registry (
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
  anonymous_execute_expected
)
values
(
  'atlas.work_result_contract_v1(uuid,uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  false,
  1,
  0,
  jsonb_build_object(
    'caller', 'app/api/atlas/work-result/route.ts',
    'purpose', 'Read typed result fields and append-only prior submissions for one authorized task.',
    'contractVersion', 'structured_work_result_v1',
    'authorizationBoundary', 'Delegates actor/effective membership validation to the task execution visibility context.',
    'publicInheritanceRemoved', true
  ),
  false
),
(
  'atlas.record_work_result_submission_v1(uuid,jsonb,text,uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  false,
  1,
  0,
  jsonb_build_object(
    'caller', 'app/api/atlas/work-result/route.ts',
    'purpose', 'Append one typed structured result submission without inferring task completion.',
    'contractVersion', 'structured_work_result_v1',
    'authorizationBoundary', 'Delegates actor/effective membership validation to the task execution visibility context and validates field contract, types, choices, and idempotency.',
    'publicInheritanceRemoved', true
  ),
  false
)
on conflict (signature) do update set
  classification = excluded.classification,
  confidence = excluded.confidence,
  review_status = excluded.review_status,
  authenticated_execute_expected = excluded.authenticated_execute_expected,
  security_definer_expected = excluded.security_definer_expected,
  service_execute_expected = excluded.service_execute_expected,
  caller_count = excluded.caller_count,
  policy_reference_count = excluded.policy_reference_count,
  evidence = excluded.evidence,
  anonymous_execute_expected = excluded.anonymous_execute_expected,
  reviewed_at = now();
