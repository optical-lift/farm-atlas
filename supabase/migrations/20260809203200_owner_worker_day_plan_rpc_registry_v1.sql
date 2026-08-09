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
  'atlas.owner_worker_day_plan_api_v1(uuid, uuid, date)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Resolve one canonical Farm Hand day for Owner schedule planning',
    'contract','realWork + automaticWork + suggestions + capacity',
    'boundary','validates authenticated owner/manager and active target Farm Hand'
  ),
  now()
),
(
  'atlas.owner_build_worker_day_schedule_api_v2(uuid, uuid, date, jsonb)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Commit only Owner-selected purple worker-day suggestions',
    'automatic_work','Weed and mowing are excluded from Owner approval selections',
    'capacity','explicit Owner approval may intentionally exceed the daily target'
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
