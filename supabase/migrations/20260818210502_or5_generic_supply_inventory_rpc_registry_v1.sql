insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
)
values
(
  'atlas.resource_inventory_position_for_member_v1(uuid, uuid)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Return the attributable generic inventory position for an active farm member without exposing internal resource ledgers directly.',
    'boundary','Unknown quantity remains unresolved; the endpoint may recommend count or restock only when the underlying evidence and stock policy warrant it.',
    'contract','operation_result_or5'
  ),now()
),
(
  'atlas.record_generic_inventory_event_for_member_v1(uuid, uuid, text, numeric, text, uuid, text)',
  'app_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Allow an active farm member to record count, receipt, consumption, damage, discard, or depletion evidence for a quantity-governed generic resource.',
    'boundary','The endpoint cannot invent absolute quantity from a movement event when prior quantity is unknown; append-only resource events remain canonical.',
    'contract','operation_result_or5'
  ),now()
)
on conflict(signature) do update set
  classification=excluded.classification,
  confidence=excluded.confidence,
  review_status=excluded.review_status,
  authenticated_execute_expected=excluded.authenticated_execute_expected,
  security_definer_expected=excluded.security_definer_expected,
  service_execute_expected=excluded.service_execute_expected,
  evidence=excluded.evidence,
  reviewed_at=excluded.reviewed_at;