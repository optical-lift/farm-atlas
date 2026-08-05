-- Mowing task-focus pages are rendered through the trusted server client.
-- service_role bypasses RLS but still requires explicit SQL table privileges.

grant select on table
  atlas.rhythm_state,
  atlas.mowing_area_state
to service_role;
