insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,
  authenticated_execute_expected,security_definer_expected,service_execute_expected,
  caller_count,policy_reference_count,evidence,reviewed_at
) values (
  'atlas.harvest_inventory_reality_expression_v1(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Phase 9 read-only Reality Expression packet for Harvest lineage, Ready inventory custody, customer/event claims, fulfillment, disposition, and revenue/demand reconciliation.',
    'boundary','Service-internal composition over existing Harvest and commercial truth rails. No generic claim table and no direct authenticated execution.',
    'architecture','Physical quantity is distinct from availability; active claims retain source/destination; fulfilled and disposed quantities leave current physical custody; demand allocations converted to sales are not double-counted.'
  ),now()
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