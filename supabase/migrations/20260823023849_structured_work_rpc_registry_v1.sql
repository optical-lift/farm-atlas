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
  reviewed_at,
  anonymous_execute_expected
)
values
  (
    'atlas.worker_task_execution_structure_api_v1(uuid)',
    'app_endpoint','verified','active',true,true,true,1,0,
    jsonb_build_object(
      'purpose','Read the compact structured parts and relations for one task through the authenticated worker boundary.',
      'caller','app/api/atlas/task-execution-structure/route.ts',
      'authorizationBoundary','Function requires auth.uid(), active farm membership, and either management or exact task assignment.',
      'contractVersion','worker_task_execution_structure_v1',
      'publicInheritanceRemoved',true
    ),now(),now(),false
  ),
  (
    'atlas.sync_task_execution_components_from_canonical_v1(uuid)',
    'service_internal','verified','active',false,true,true,0,1,
    jsonb_build_object(
      'purpose','Mirror canonical task objects, resources, crop cycles, prerequisites, gates, and numeric parameters into the structured execution grammar.',
      'caller','database triggers and migrations',
      'authorizationBoundary','Not a signed-in client RPC surface; service/database-owner execution only.',
      'contractVersion','canonical_task_execution_component_mirror_v1',
      'publicInheritanceRemoved',true
    ),now(),now(),false
  ),
  (
    'atlas.work_result_contract_v1(uuid,uuid)',
    'app_endpoint','verified','active',true,true,false,1,0,
    jsonb_build_object(
      'purpose','Read typed result fields and append-only prior submissions for one authorized task.',
      'caller','app/api/atlas/work-result/route.ts',
      'authorizationBoundary','Delegates actor/effective membership validation to the task execution visibility context.',
      'contractVersion','structured_work_result_v1',
      'publicInheritanceRemoved',true
    ),now(),now(),false
  ),
  (
    'atlas.record_work_result_submission_v1(uuid,jsonb,text,uuid)',
    'app_endpoint','verified','active',true,true,false,1,0,
    jsonb_build_object(
      'purpose','Append one typed structured result submission without inferring task completion.',
      'caller','app/api/atlas/work-result/route.ts',
      'authorizationBoundary','Delegates actor/effective membership validation to the task execution visibility context and validates field contract, types, choices, and idempotency.',
      'contractVersion','structured_work_result_v1',
      'publicInheritanceRemoved',true
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