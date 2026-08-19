insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.farm_continuity_audit_v3(uuid, date)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Expose Farm Operations continuity truth through Reality Expression v3 without mutating farm truth or creating Principal work.',
    'boundary','Any active farm member may read the farm continuity audit; the function performs an explicit membership check before composing internal continuity and Reality Expression contracts.',
    'principalBoundary','Continuity findings remain Farm Operations truth until an explicit escalation threshold translates them into an ownership decision.'
  ),now()
)
on conflict (signature) do update
set classification=excluded.classification,
    confidence=excluded.confidence,
    review_status=excluded.review_status,
    authenticated_execute_expected=excluded.authenticated_execute_expected,
    security_definer_expected=excluded.security_definer_expected,
    service_execute_expected=excluded.service_execute_expected,
    caller_count=excluded.caller_count,
    policy_reference_count=excluded.policy_reference_count,
    evidence=excluded.evidence,
    reviewed_at=excluded.reviewed_at;
