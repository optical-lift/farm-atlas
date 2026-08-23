-- Keep the signed-in structured-work read boundary explicit in the governed RPC registry.
-- The copy helper remains service-only; authenticated callers reach only the read API.

revoke all on function atlas.worker_task_execution_structure_api_v1(uuid) from public, anon;
grant execute on function atlas.worker_task_execution_structure_api_v1(uuid) to authenticated, service_role;

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
values (
  'atlas.worker_task_execution_structure_api_v1(uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'caller', 'app/api/atlas/task-execution-structure/route.ts',
    'purpose', 'Read the compact structured parts and relations for one task through the authenticated worker boundary.',
    'contractVersion', 'worker_task_execution_structure_v1',
    'authorizationBoundary', 'Function requires auth.uid(), active farm membership, and either management or exact task assignment.',
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
