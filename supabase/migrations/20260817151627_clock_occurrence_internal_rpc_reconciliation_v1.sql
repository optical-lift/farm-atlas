revoke all on function atlas.resolve_clock_placement_occurrence_v1(uuid) from public;
revoke execute on function atlas.resolve_clock_placement_occurrence_v1(uuid) from anon, authenticated;
grant execute on function atlas.resolve_clock_placement_occurrence_v1(uuid) to service_role;

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
) values (
  'atlas.resolve_clock_placement_occurrence_v1(uuid)',
  'service_internal',
  'verified',
  'active',
  false,
  true,
  true,
  1,
  0,
  jsonb_build_object(
    'purpose','Deterministically resolves the current planned work occurrence used when Clock placement provenance is captured.',
    'boundary','Internal provenance helper; not an app endpoint.',
    'callerTruth','Database audit found capture_clock_placement_occurrence_v1() as the only function caller.',
    'securityTruth','Authenticated execution revoked; service/internal execution retained.',
    'reconciliationReason','Production history recovery exposed an unregistered authenticated grant from the original Clock provenance migration.'
  ),
  now(),
  now()
)
on conflict(signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  caller_count=excluded.caller_count,
  policy_reference_count=excluded.policy_reference_count,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;