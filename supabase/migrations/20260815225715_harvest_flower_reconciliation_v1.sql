do $apply$
declare
  r record;
begin
  select * into r from http_get('https://raw.githubusercontent.com/optical-lift/farm-atlas/59a8a532b13b9fcc3f8eded5b8c58f931000a237/supabase/migrations/20260815144000_harvest_flower_reconciliation_v1.sql');
  if r.status <> 200 then
    raise exception 'Could not fetch pinned Harvest reconciliation migration: HTTP %', r.status;
  end if;
  execute r.content;
end
$apply$;