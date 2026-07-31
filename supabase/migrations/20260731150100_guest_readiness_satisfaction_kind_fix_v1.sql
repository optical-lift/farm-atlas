-- Reconcile Guest Readiness with the canonical rhythm satisfaction vocabulary.

do $$
declare
  v_definition text;
begin
  select pg_get_functiondef(p.oid) into v_definition
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='record_guest_readiness_round_core_v1';

  if v_definition is null then
    raise exception 'Guest Readiness core function was not found.';
  end if;

  if position('''full_renewal''' in v_definition)>0 then
    execute replace(v_definition,'''full_renewal''','''full''');
  end if;
end;
$$;
