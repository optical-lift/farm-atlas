begin;

insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, reviewed_at
)
values
(
  'atlas.crop_cycle_spatial_truth_v1(uuid)',
  'service_internal','verified','active',false,false,true,1,0,
  jsonb_build_object(
    'purpose','Read one crop cycle spatially without mutating claims, placement, lifecycle, or task state.',
    'boundary','Reality Expression Pass 1.1 is service/internal only. Public Owner and Worker projections must use jurisdiction-specific wrappers later.',
    'truthLaw','Registry disposition, physical presence, represented claim, and co-occupancy evidence remain separate; supersession never proves physical release or prior physical presence.',
    'callerTruth','Composed by atlas.crop_cycle_reality_expression_v2(uuid).'
  ),
  now()
),
(
  'atlas.crop_cycle_reality_expression_v2(uuid)',
  'service_internal','verified','active',false,false,true,0,0,
  jsonb_build_object(
    'purpose','Compose the Pass 1 living-body packet with explicit relation and claim truth.',
    'boundary','Service/internal read model only; no authenticated browser execution and no mutation authority.',
    'truthLaw','Same-object occupancy remains unresolved unless explicit evidence proves release, sole occupancy, or disjoint shared placement.'
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