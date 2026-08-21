insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,registered_at,reviewed_at,anonymous_execute_expected
)
values
(
  'atlas.record_germination_observation_for_member_v3(uuid, uuid, text, text, text, numeric, text)',
  'app_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'purpose','Record germination observations while treating explicit failure as a bed release and Owner crop-decision obligation rather than an automatic resow.',
    'caller','POST /api/atlas/germination-check',
    'authorizationBoundary','The wrapper verifies active farm membership and assigned-worker scope before delegating explicit failure to the internal bed-release command.',
    'truthBoundary','Failed germination archives the failed crop cycle, opens the bed, and requests a new crop decision; it never chooses the replacement crop.'
  ),now(),now(),false
),
(
  'atlas.owner_operator_record_germination_observation_v3(uuid, uuid, text, text, numeric, text)',
  'owner_admin_endpoint','verified','active',true,true,true,1,1,
  jsonb_build_object(
    'purpose','Provide Owner operator-mode parity for germination observations including explicit failed-planting bed release.',
    'caller','POST /api/atlas/germination-check in operator mode',
    'authorizationBoundary','The wrapper resolves the selected effective membership and enforces its farm role and assignment before delegating.',
    'truthBoundary','Operator mode changes actor context only; it does not change the crop-cycle consequence of a failed planting.'
  ),now(),now(),false
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
