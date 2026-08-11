-- Day choreography internal helper lockdown v1
-- The composed Owner plan is an implementation helper. Authenticated clients use
-- the checked API wrapper; direct helper execution remains service-only.

revoke all on function atlas.owner_worker_day_plan_choreographed_v1(uuid,uuid,date)
  from public, anon, authenticated;

grant execute on function atlas.owner_worker_day_plan_choreographed_v1(uuid,uuid,date)
  to service_role;

-- A service-only helper does not belong in the authenticated RPC registry.
delete from atlas.authenticated_rpc_registry
where signature='atlas.owner_worker_day_plan_choreographed_v1(uuid, uuid, date)';
