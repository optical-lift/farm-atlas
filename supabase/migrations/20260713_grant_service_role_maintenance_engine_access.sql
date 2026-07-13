-- Atlas maintenance engine runs through the trusted server client.
-- Supabase service_role bypasses RLS but still needs SQL table privileges.

grant select on table
  atlas.maintenance_type_profiles,
  atlas.maintenance_scheduler_settings
to service_role;

grant select, update on table
  atlas.maintenance_objects,
  atlas.maintenance_dependencies
to service_role;

grant select, insert on table
  atlas.maintenance_history
to service_role;
