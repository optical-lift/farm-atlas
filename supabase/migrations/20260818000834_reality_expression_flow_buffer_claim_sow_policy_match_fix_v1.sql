do $migration$
declare
  v_oid oid;
  v_def text;
  v_old text := '(upper(coalesce(r.match_action_key,''''))=''SOW'' or upper(coalesce(r.match_task_type,''''))=''SOW_SEEDS'')';
  v_new text := '(upper(coalesce(r.match_action_key,''''))=''SOW'' or lower(coalesce(r.match_task_type,'''')) in (''sowing'',''succession_sowing'',''sow_seeds''))';
begin
  select p.oid into v_oid
  from pg_proc p
  join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='atlas'
    and p.proname='production_flow_buffer_claim_v1'
    and pg_get_function_identity_arguments(p.oid)='p_production_lot_id uuid';

  if v_oid is null then
    raise exception 'atlas.production_flow_buffer_claim_v1(uuid) not found';
  end if;

  v_def := pg_get_functiondef(v_oid);
  if position(v_old in v_def)=0 then
    raise exception 'Expected sow policy matcher not found in production_flow_buffer_claim_v1';
  end if;

  v_def := replace(v_def,v_old,v_new);
  execute v_def;
end;
$migration$;

revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from public;
revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from anon;
revoke all on function atlas.production_flow_buffer_claim_v1(uuid) from authenticated;
grant execute on function atlas.production_flow_buffer_claim_v1(uuid) to service_role;
