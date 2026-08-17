begin;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.crop_cycle_relation_resolution_requirements_v1(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object(
    'purpose','Describe the evidence and jurisdiction required to resolve one crop spatial relation without mutating reality.',
    'boundary','Reality Expression Pass 1.2 is read-only and service/internal. Witness capability is kept separate from spatial and claim mutation authority.',
    'truthLaw','Observation is evidence, not automatic adjudication. Present absence does not backdate release; same-object membership does not prove conflict or sharing.',
    'callerTruth','Composed by atlas.crop_cycle_reality_expression_v3(uuid).'
  ),
  now()
),
(
  'atlas.crop_cycle_reality_expression_v3(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Compose living-body, spatial truth, and evidence/adjudication resolution boundary for one crop cycle.',
    'boundary','Service/internal read model only; no authenticated execution and no mutation authority.',
    'truthLaw','A reality packet may name missing evidence and lawful jurisdiction without forcing completeness or performing the adjudication itself.'
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

commit;