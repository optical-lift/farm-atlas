do $apply$
declare
  r record;
begin
  select * into r from http_get('https://raw.githubusercontent.com/optical-lift/farm-atlas/c017a5207fcabfe99e54c3ea42301d6eb2d361cf/supabase/migrations/20260815143300_harvest_flower_commercial_reversals_rpc_registry_v1.sql');
  if r.status <> 200 then raise exception 'Could not fetch pinned Harvest migration: HTTP %', r.status; end if;
  execute r.content;
end
$apply$;