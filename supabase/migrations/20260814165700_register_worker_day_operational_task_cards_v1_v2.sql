insert into atlas.authenticated_rpc_registry (
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.worker_day_operational_task_cards_v1(uuid, uuid, uuid[])',
  'app_endpoint', 'verified', 'active', true, true, true, 0, 0,
  jsonb_build_object(
    'purpose','Compatibility lightweight operational Day-card reader for already-selected task IDs',
    'boundary','worker self or farm manager/owner; target membership must be active',
    'hydration','base task truth plus current object state, latest result/transition, and batched move context; no rich v_task_cards history'
  ), now(), now()
),
(
  'atlas.worker_day_operational_task_cards_v2(uuid, uuid, date, uuid[])',
  'app_endpoint', 'verified', 'active', true, true, true, 1, 0,
  jsonb_build_object(
    'purpose','Canonical lightweight operational Day-card reader for Worker Day runtime',
    'boundary','worker self or farm manager/owner; target membership must be active',
    'completionEcho','adds top-level tasks completed on the service date without full rich-card hydration',
    'hydration','base task truth plus current object state, latest result/transition, and batched move context; no rich v_task_cards history'
  ), now(), now()
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
  reviewed_at=now();
