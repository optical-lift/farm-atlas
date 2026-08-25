revoke all on function atlas.seed_community_thursday_venue_cycle_checklist_v1(uuid) from public, anon, authenticated, service_role;

comment on function atlas.seed_community_thursday_venue_cycle_checklist_v1(uuid) is
'Thursdays at Elm Venue checklist seeder. Internal trigger-only helper; execute authority remains owner-only so CREATE OR REPLACE replay cannot silently reopen RPC execution.';