-- Owner Day reservation authenticated RPC registry reconciliation v1
-- Keeps reservation mutation/projection execution explicit and reviewable.

revoke all on function atlas.owner_command_day_reservation_api_v1(uuid,uuid,date,jsonb) from public, anon;
revoke all on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) from public, anon;

grant execute on function atlas.owner_command_day_reservation_api_v1(uuid,uuid,date,jsonb) to authenticated, service_role;
grant execute on function atlas.sync_fixed_routine_reservations_for_day_v1(uuid,uuid,date) to authenticated, service_role;

insert into atlas.authenticated_rpc_registry (
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
  reviewed_at
)
values
(
  'atlas.owner_command_day_reservation_api_v1(uuid, uuid, date, jsonb)',
  'owner_admin_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Create, change, move, resize, or remove one dated non-task Worker Day reservation',
    'boundary','farm Owner only with active Farm Hand target membership',
    'taskTruth','reservation mutation does not create task status, dependency, recurrence, or Task Focus truth'
  ),now()
),
(
  'atlas.sync_fixed_routine_reservations_for_day_v1(uuid, uuid, date)',
  'app_endpoint','verified','active',true,true,true,1,0,
  jsonb_build_object(
    'purpose','Materialize applicable fixed-routine definitions into dated Worker Day reservations',
    'boundary','target Farm Hand or farm Owner with active membership',
    'taskTruth','routine projection writes reservations and never recurring tasks'
  ),now()
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
