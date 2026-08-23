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
  'atlas.worker_executable_task_ids_v1(uuid,uuid,uuid[],date)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  1,
  jsonb_build_object(
    'purpose','Batch the canonical execution-warrant check for worker-facing dated task cards so unready work never enters the worker execution list.',
    'caller','GET /api/atlas/universal-task-cards',
    'authorizationBoundary','The security-definer helper requires an active target membership and allows only that worker or same-farm management to inspect the supplied task-id set.',
    'truthBoundary','The helper returns task ids only. Missing readiness remains an Owner/management intervention and is not converted into a worker-facing waiting card.'
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
