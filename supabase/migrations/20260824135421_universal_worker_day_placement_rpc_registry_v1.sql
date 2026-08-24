insert into atlas.authenticated_rpc_registry(
  signature,classification,confidence,review_status,authenticated_execute_expected,
  security_definer_expected,service_execute_expected,caller_count,policy_reference_count,
  evidence,anonymous_execute_expected,registered_at,reviewed_at
)
values(
  'atlas.owner_set_work_definition_day_placement_api_v1(uuid, uuid, text, numeric, text, text)',
  'owner_admin_endpoint','verified','active',true,true,true,0,0,
  jsonb_build_object(
    'purpose','Author standing Worker Day placement on an active work definition without task-family code.',
    'boundary','Farm Owner only; exact occurrence edits remain in worker_day_task_placements.',
    'precedence','manual occurrence placement > work definition placement > task metadata > operational fallback',
    'registeredBy','universal_worker_day_placement_rpc_registry_v1',
    'publicInheritanceRemoved',true
  ),false,now(),now()
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
  evidence=atlas.authenticated_rpc_registry.evidence || excluded.evidence,
  anonymous_execute_expected=excluded.anonymous_execute_expected,
  reviewed_at=now();