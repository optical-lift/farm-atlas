do $do$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='reality_expression_packet_v1'
    and pg_get_function_identity_arguments(p.oid)='p_production_lot_id uuid';

  if v_def is null then raise exception 'reality_expression_packet_v1(uuid) not found'; end if;

  v_def := replace(v_def,
    $$'cropCycleId',cycle.id,
           'linkRole',link.link_role,
           'source',link.source,$$,
    $$'cropCycleId',cycle.id,
           'relationRole',link.relation_role,
           'confidence',link.confidence,
           'source',link.source,$$
  );
  execute v_def;
end
$do$;