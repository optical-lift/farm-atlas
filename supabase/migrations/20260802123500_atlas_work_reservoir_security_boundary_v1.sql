begin;

alter function atlas.work_effort_units_v1(text, jsonb)
  set search_path = pg_catalog, atlas;
alter function atlas.derive_work_lane_v1(text, text, text, text, jsonb)
  set search_path = pg_catalog, atlas;
alter function atlas.derive_commitment_kind_v1(text, text, jsonb)
  set search_path = pg_catalog, atlas;

revoke execute on function atlas.work_effort_units_v1(text, jsonb) from public, anon, authenticated;
revoke execute on function atlas.derive_work_lane_v1(text, text, text, text, jsonb) from public, anon, authenticated;
revoke execute on function atlas.derive_commitment_kind_v1(text, text, jsonb) from public, anon, authenticated;
revoke execute on function atlas.decorate_task_work_reservoir_v1() from public, anon, authenticated;
revoke execute on function atlas.member_day_load_core_v1(uuid, uuid, date, uuid) from public, anon, authenticated;
revoke execute on function atlas.member_day_load_v1(uuid, uuid, date) from public, anon, authenticated;
revoke execute on function atlas.object_work_context_v2(uuid, text, uuid, date) from public, anon, authenticated;
revoke execute on function atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text) from public, anon, authenticated;
revoke execute on function atlas.work_occurrence_gate_satisfied_v1(uuid, date) from public, anon, authenticated;

grant execute on function atlas.work_effort_units_v1(text, jsonb) to service_role;
grant execute on function atlas.derive_work_lane_v1(text, text, text, text, jsonb) to service_role;
grant execute on function atlas.derive_commitment_kind_v1(text, text, jsonb) to service_role;
grant execute on function atlas.decorate_task_work_reservoir_v1() to service_role;
grant execute on function atlas.member_day_load_core_v1(uuid, uuid, date, uuid) to service_role;
grant execute on function atlas.member_day_load_v1(uuid, uuid, date) to authenticated, service_role;
grant execute on function atlas.object_work_context_v2(uuid, text, uuid, date) to authenticated, service_role;
grant execute on function atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text) to authenticated, service_role;
grant execute on function atlas.work_occurrence_gate_satisfied_v1(uuid, date) to service_role;

delete from atlas.authenticated_rpc_registry
where signature = any(array[
  'atlas.work_effort_units_v1(text, jsonb)',
  'atlas.derive_work_lane_v1(text, text, text, text, jsonb)',
  'atlas.derive_commitment_kind_v1(text, text, jsonb)',
  'atlas.decorate_task_work_reservoir_v1()',
  'atlas.member_day_load_core_v1(uuid, uuid, date, uuid)',
  'atlas.work_occurrence_gate_satisfied_v1(uuid, date)'
]);

insert into atlas.authenticated_rpc_registry(
  signature, classification, confidence, review_status,
  authenticated_execute_expected, security_definer_expected, service_execute_expected,
  caller_count, policy_reference_count, evidence, registered_at, reviewed_at
) values
(
  'atlas.member_day_load_v1(uuid, uuid, date)', 'policy_or_composition_helper', 'verified', 'active',
  true, true, true, 2, 0,
  jsonb_build_object('source','work_reservoir_security_boundary_v1','call_site','object work composer and Presented Work','authorization','self or farm management','reviewed_date','2026-08-02'), now(), now()
),
(
  'atlas.object_work_context_v2(uuid, text, uuid, date)', 'app_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','work_reservoir_security_boundary_v1','call_site','object work composer','authorization','active same-farm membership','reviewed_date','2026-08-02'), now(), now()
),
(
  'atlas.create_object_work_v2(uuid, text, text, text, text, text, text, text, uuid, date, text, text, boolean, uuid[], text[], text)', 'owner_admin_endpoint', 'verified', 'active',
  true, true, true, 1, 0,
  jsonb_build_object('source','work_reservoir_security_boundary_v1','call_site','object work composer','authorization','owner or manager','reviewed_date','2026-08-02'), now(), now()
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

commit;
