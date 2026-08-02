begin;

-- Harvest horizon scheduling and task suppression are service-internal. They were
-- created after the authenticated RPC registry bootstrap and inherited PUBLIC
-- execution. Close that boundary and keep the registry aligned with the catalog.

revoke execute on function atlas.harvest_horizon_tick_v1(uuid, date)
  from public, anon, authenticated;
revoke execute on function atlas.suppress_harvest_watch_task_v1()
  from public, anon, authenticated;

grant execute on function atlas.harvest_horizon_tick_v1(uuid, date)
  to service_role;
grant execute on function atlas.suppress_harvest_watch_task_v1()
  to service_role;

delete from atlas.authenticated_rpc_registry
where signature = any(array[
  'atlas.harvest_horizon_tick_v1(uuid, date)',
  'atlas.suppress_harvest_watch_task_v1()'
]);

commit;
