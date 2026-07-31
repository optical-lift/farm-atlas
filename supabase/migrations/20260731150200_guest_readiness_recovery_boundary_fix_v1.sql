-- Reconcile Guest Readiness recovery events with the canonical Clock boundary grammar.

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

  if position('''observation'',v_now,v_now,null,v_task.id' in v_definition)>0 then
    execute replace(
      v_definition,
      '''observation'',v_now,v_now,null,v_task.id',
      '''partial_result'',v_now,v_now,null,v_task.id'
    );
  end if;
end;
$$;
