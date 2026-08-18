do $do$
declare
  v_oid oid;
  v_def text;
  v_old text := $old$  select count(*)::integer,min(link.production_lot_id)
  into v_lot_count,v_lot_id
  from atlas.production_lot_tasks link
  where link.task_id=p_task_id;
  if v_lot_count<>1 then v_lot_id:=null; end if;$old$;
  v_new text := $new$  select count(*)::integer
  into v_lot_count
  from atlas.production_lot_tasks link
  where link.task_id=p_task_id;
  if v_lot_count=1 then
    select link.production_lot_id into v_lot_id
    from atlas.production_lot_tasks link
    where link.task_id=p_task_id
    limit 1;
  else
    v_lot_id:=null;
  end if;$new$;
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='worker_record_state_transition_result_v1'
    and pg_get_function_identity_arguments(p.oid)='p_farm_id uuid, p_membership_id uuid, p_task_id uuid, p_service_date date, p_result text, p_actual_minutes integer, p_idempotency_key text, p_quantity numeric, p_unit text, p_note text, p_reason text, p_result_payload jsonb';
  if v_oid is null then raise exception 'Phase 6 result RPC not found.'; end if;
  v_def:=pg_get_functiondef(v_oid);
  if position(v_old in v_def)=0 then raise exception 'Expected single-lot query was not found in Phase 6 result RPC.'; end if;
  v_def:=replace(v_def,v_old,v_new);
  execute v_def;
end
$do$;
