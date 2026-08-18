do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='harvest_inventory_reality_expression_v1'
    and pg_get_function_identity_arguments(p.oid)='p_ready_lot_id uuid';
  if v_def is null then raise exception 'harvest_inventory_reality_expression_v1(uuid) not found'; end if;
  if position($needle$ha.status in ('ready','open','available','harvest_ready')$needle$ in v_def)=0 then
    raise exception 'Expected Phase 9 field-readiness vocabulary was not found';
  end if;
  v_def := replace(v_def,$old$ha.status in ('ready','open','available','harvest_ready')$old$,$new$ha.status='harvestable'$new$);
  v_def := replace(v_def,'explicit ready/open/available state','explicit harvestable state');
  execute v_def;
end;
$patch$;