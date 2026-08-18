insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
  (
    'atlas.production_flow_buffer_claim_v1(uuid)',
    'service_internal','verified','active',
    false,false,true,
    0,0,
    jsonb_build_object(
      'purpose','Read-only Phase 4 Flow / Buffer / Claim projection for one canonical Production Lot.',
      'boundary','Service/internal projection only. It distinguishes possession, physical warrant, claims, labor estimates, labor claims, destination readiness, and transition availability without mutating canonical state.',
      'truthLaw','Reservation is not physical proof; multiple claims are not conflict without capacity evidence; a labor estimate is not a human-time claim; unresolved destination/readiness is not executable availability.'
    ),
    now()
  ),
  (
    'atlas.reality_expression_packet_v2(uuid)',
    'service_internal','verified','active',
    false,false,true,
    0,0,
    jsonb_build_object(
      'purpose','Read-only composed Reality Expression packet adding Phase 4 Flow / Buffer / Claim truth to the Phase 3 Production adapter.',
      'boundary','Service/internal composition only. It delegates canonical Production truth to reality_expression_packet_v1 and adds production_flow_buffer_claim_v1 without duplicate writes.',
      'truthLaw','Composition must preserve the evidence and availability boundaries of both contracts and may not manufacture current physical state, conflict, human assignment, capacity fit, or executable readiness.'
    ),
    now()
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
