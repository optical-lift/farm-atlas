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
values (
  'atlas.record_buyer_outreach_result_v1(uuid, text, text, text, text, text, integer, numeric, date, uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Record one durable buyer contact event from an authenticated Atlas sales-outreach task',
    'caller','app/api/atlas/buyer-outreach/route.ts',
    'boundary','requires an active farm membership, assigned worker or owner/manager override, and a task-linked buyer sales channel'
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