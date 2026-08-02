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

commit;
