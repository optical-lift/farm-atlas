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
  reviewed_at
)
values
(
  'atlas.sky_state_at_v1(uuid, timestamp with time zone)',
  'app_endpoint',
  'provisional',
  'active',
  true,
  true,
  true,
  0,
  0,
  jsonb_build_object(
    'purpose','Read farm-local factual sky state at a timestamp',
    'boundary','authenticated farm-member read; interpretation remains separate'
  ),
  now()
),
(
  'atlas.task_sky_fitness_v1(uuid, timestamp with time zone)',
  'app_endpoint',
  'provisional',
  'active',
  true,
  true,
  true,
  0,
  0,
  jsonb_build_object(
    'purpose','Read the approved sky fitness rule result for one canonical task',
    'boundary','authenticated farm-member read over task operation class and approved rule state'
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
