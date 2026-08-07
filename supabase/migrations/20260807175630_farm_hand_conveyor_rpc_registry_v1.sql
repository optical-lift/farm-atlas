begin;

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
  reviewed_at
) values
(
  'atlas.report_worker_needs_lighter_work_v1(uuid)',
  'app_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  2,
  jsonb_build_object(
    'source','farm_hand_conveyor_rpc_registry_v1',
    'call_site','Farm Hand Conveyor Need lighter work action',
    'authorization','signed-in worker may report only against their own assigned task',
    'reviewed_date','2026-08-07'
  ),
  now(),
  now()
),
(
  'atlas.acknowledge_worker_support_event_v1(uuid)',
  'owner_admin_endpoint',
  'verified',
  'active',
  true,
  true,
  true,
  0,
  1,
  jsonb_build_object(
    'source','farm_hand_conveyor_rpc_registry_v1',
    'call_site','Owner stewardship support event acknowledgement',
    'authorization','farm owner only',
    'reviewed_date','2026-08-07'
  ),
  now(),
  now()
),
(
  'atlas.consume_worker_recovery_move_v1(uuid)',
  'policy_or_composition_helper',
  'verified',
  'active',
  true,
  true,
  true,
  1,
  1,
  jsonb_build_object(
    'source','farm_hand_conveyor_rpc_registry_v1',
    'call_site','canonical task transition route after farm-hand completion',
    'authorization','signed-in worker may consume recovery state only for their own assigned task',
    'reviewed_date','2026-08-07'
  ),
  now(),
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
    evidence = coalesce(atlas.authenticated_rpc_registry.evidence,'{}'::jsonb) || excluded.evidence,
    reviewed_at = excluded.reviewed_at;

commit;
