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
)
values(
  'atlas.worker_task_execution_readiness_api_v1(uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  1,
  jsonb_build_object(
    'purpose','Expose the canonical task execution warrant to the signed-in assigned worker or farm management without granting authenticated callers direct access to the internal readiness function.',
    'caller','GET /api/atlas/task-execution-readiness',
    'authorizationBoundary','The security-definer wrapper verifies active same-farm membership and requires farm management or the task-assigned/executor membership before delegating to atlas.task_execution_readiness_v1.',
    'truthBoundary','A transport or permission failure is not a canonical Worker Waiting state.'
  ),
  now(),
  now()
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
  reviewed_at=now();
