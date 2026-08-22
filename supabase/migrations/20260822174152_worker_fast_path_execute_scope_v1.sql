-- Keep worker first-paint helpers behind the authorized API membranes.
-- SECURITY DEFINER helpers remain callable by their owning wrapper functions,
-- but are not direct client RPC surfaces.

revoke all on function atlas.presented_work_selection_rows_live_v1(uuid, uuid, date) from public;
revoke all on function atlas.presented_work_selection_rows_live_v1(uuid, uuid, date) from anon;
revoke all on function atlas.presented_work_selection_rows_live_v1(uuid, uuid, date) from authenticated;

revoke all on function atlas.worker_day_feed_plan_live_v1(uuid, uuid, date) from public;
revoke all on function atlas.worker_day_feed_plan_live_v1(uuid, uuid, date) from anon;
revoke all on function atlas.worker_day_feed_plan_live_v1(uuid, uuid, date) from authenticated;

-- These are authenticated API membranes. Remove PUBLIC/anon inheritance and
-- leave only the explicit authenticated execution grant.
revoke all on function atlas.day_reservations_api_v2(uuid, uuid, date) from public;
revoke all on function atlas.day_reservations_api_v2(uuid, uuid, date) from anon;
revoke all on function atlas.day_reservations_api_v2(uuid, uuid, date) from authenticated;
grant execute on function atlas.day_reservations_api_v2(uuid, uuid, date) to authenticated;

revoke all on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) from public;
revoke all on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) from anon;
revoke all on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) from authenticated;
grant execute on function atlas.worker_day_choreography_bundle_api_v2(uuid, uuid, date) to authenticated;

comment on function atlas.worker_day_feed_plan_live_v1(uuid, uuid, date)
  is 'Internal live Worker Day feed helper. Execute only through authorized Atlas API wrappers.';
comment on function atlas.presented_work_selection_rows_live_v1(uuid, uuid, date)
  is 'Internal live presented-work selector. Execute only through authorized Atlas API wrappers.';
