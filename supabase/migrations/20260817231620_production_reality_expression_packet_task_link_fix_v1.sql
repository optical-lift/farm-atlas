do $do$
declare
  v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='reality_expression_packet_v1'
    and pg_get_function_identity_arguments(p.oid)='p_production_lot_id uuid';

  if v_def is null then
    raise exception 'reality_expression_packet_v1(uuid) not found';
  end if;

  v_def := replace(v_def,
    $$'relationRole',link.relation_role,
           'confidence',link.confidence,$$,
    $$'linkRole',link.link_role,$$
  );

  execute v_def;
end
$do$;

comment on function atlas.reality_expression_packet_v1(uuid) is
  'Read-only Production Reality Adapter v1. Reconstructs a Production Lot reality packet from canonical production, event, seed-allocation, crop-lineage, destination/capacity-readiness, and task-link truth without writing duplicate state.';