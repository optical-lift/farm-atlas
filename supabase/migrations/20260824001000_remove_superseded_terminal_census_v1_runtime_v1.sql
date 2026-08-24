-- Finished-software cleanup: terminal census v1 is superseded by self-contained v2.
-- Preserve v1 in migration history only; remove it from the current executable schema.

do $migration$
begin
  delete from atlas.authenticated_rpc_registry
  where signature = 'atlas.farm_continuity_terminal_census_v1(uuid, date)';

  drop function if exists atlas.farm_continuity_terminal_census_v1(uuid,date) restrict;
end;
$migration$;
