do $patch$
declare v_def text;
begin
  select pg_get_functiondef(p.oid) into v_def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas' and p.proname='harvest_inventory_reality_expression_v1'
    and pg_get_function_identity_arguments(p.oid)='p_ready_lot_id uuid';
  if v_def is null then raise exception 'harvest_inventory_reality_expression_v1(uuid) not found'; end if;
  if position($needle$'activeCommittedProductRevenue',v_position.active_committed_product_revenue,$needle$ in v_def)=0 then
    raise exception 'Expected Phase 9 revenue field was not found';
  end if;
  v_def := replace(
    v_def,
    $old$'activeCommittedProductRevenue',v_position.active_committed_product_revenue,$old$,
    $new$'recordedNoncancelledSaleRevenue',v_position.active_committed_product_revenue,
      'outstandingCommittedProductRevenue',greatest(coalesce(v_position.active_committed_product_revenue,0)-coalesce(v_position.realized_product_revenue,0),0),$new$
  );
  v_def := replace(
    v_def,
    'Revenue and demand are reconciled through native sale, demand, allocation, fulfillment, and Ready inventory rails rather than inferred from physical quantity alone.',
    'Revenue and demand are reconciled through native sale, demand, allocation, fulfillment, and Ready inventory rails. Outstanding committed revenue excludes fulfilled sale value; realized revenue is reported separately.'
  );
  execute v_def;
end;
$patch$;