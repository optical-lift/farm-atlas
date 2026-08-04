-- The task-focus server loader uses the service-role client to read the
-- current room states for a guest-readiness round. Keep that read narrow:
-- state only, no write privilege and no access to readiness history.

begin;

grant select on table atlas.guest_readiness_room_state to service_role;

commit;
