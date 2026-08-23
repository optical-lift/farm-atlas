create or replace function atlas.future_truth_preflight_tick_v1()
returns jsonb
language sql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
  select atlas.future_truth_preflight_tick_v1((now() at time zone 'America/Chicago')::date);
$function$;

revoke all on function atlas.future_truth_preflight_tick_v1() from public,anon,authenticated;
grant execute on function atlas.future_truth_preflight_tick_v1() to service_role;

comment on function atlas.future_truth_preflight_tick_v1() is
'Tranche 1F service clock wrapper. Delegates to the date-parameter future truth preflight engine so scheduled and testable lifecycle paths share one implementation.';