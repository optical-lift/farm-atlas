-- Allow the server-only integrity report to traverse the Phase 2 graph view.
-- Public, anon, and authenticated roles remain unchanged.

grant select on table atlas.plant_instances to service_role;
notify pgrst, 'reload schema';
