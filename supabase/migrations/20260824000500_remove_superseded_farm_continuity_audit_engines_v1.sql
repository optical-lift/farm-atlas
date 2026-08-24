-- Finished-software cleanup: historical farm_continuity_audit_vN engines are no longer
-- part of the executable Atlas schema. Their original migration files remain the
-- deployment/history record; current continuity authority is farm_continuity_terminal_census_v2
-- composed through atlas_wide_continuity_summary_v1.
--
-- RESTRICT is intentional: if any current executable object still depends on one of
-- these historical engines, this migration must fail rather than silently cascade.
do $cleanup$
declare
  r record;
begin
  for r in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'atlas'
      and p.proname ~ '^farm_continuity_audit_v[0-9]+$'
    order by p.proname
  loop
    execute format('drop function %s restrict', r.signature);
  end loop;
end
$cleanup$;

delete from atlas.authenticated_rpc_registry
where signature ~ '^atlas\.farm_continuity_audit_v[0-9]+\(';

comment on function atlas.farm_continuity_terminal_census_v2(uuid,date) is
  'Canonical service-internal current-state farm continuity proof. Historical farm_continuity_audit_vN engines have been removed from the executable schema; migration history remains provenance only.';
