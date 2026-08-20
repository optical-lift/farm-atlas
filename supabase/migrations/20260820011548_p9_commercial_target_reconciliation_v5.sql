create or replace function atlas.reconcile_crop_demand_target_match_v1(
  p_farm_id uuid,
  p_crop_profile_id uuid default null,
  p_product_label text default null,
  p_demand_order_id uuid default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare v record; v_count integer:=0;
begin
  if p_farm_id is null then return 0; end if;
  for v in
    select distinct c.id
    from atlas.crop_cycles c
    where c.farm_id=p_farm_id and c.lifecycle_status='active'
      and (
        (p_crop_profile_id is not null and c.crop_profile_id=p_crop_profile_id)
        or (p_product_label is not null and btrim(p_product_label)<>'' and lower(btrim(p_product_label)) in (lower(btrim(coalesce(c.variety,''))),lower(btrim(coalesce(c.crop_label,'')))))
        or (p_demand_order_id is not null and exists(
          select 1 from atlas.flower_demand_order_lines l
          where l.demand_order_id=p_demand_order_id and (
            (l.crop_profile_id is not null and l.crop_profile_id=c.crop_profile_id)
            or (l.product_label is not null and lower(btrim(l.product_label)) in (lower(btrim(coalesce(c.variety,''))),lower(btrim(coalesce(c.crop_label,'')))))
          )
        ))
      )
  loop
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v.id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;
revoke all on function atlas.reconcile_crop_demand_target_match_v1(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_demand_target_match_v1(uuid,uuid,text,uuid) to service_role;

create or replace function atlas.reconcile_crop_demand_line_target_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
begin
  if tg_op='DELETE' then
    perform atlas.reconcile_crop_demand_target_match_v1(old.farm_id,old.crop_profile_id,old.product_label,old.demand_order_id);
    return old;
  end if;
  perform atlas.reconcile_crop_demand_target_match_v1(new.farm_id,new.crop_profile_id,new.product_label,new.demand_order_id);
  if tg_op='UPDATE' and (old.crop_profile_id is distinct from new.crop_profile_id or old.product_label is distinct from new.product_label or old.demand_order_id is distinct from new.demand_order_id) then
    perform atlas.reconcile_crop_demand_target_match_v1(old.farm_id,old.crop_profile_id,old.product_label,old.demand_order_id);
  end if;
  return new;
end;
$function$;
revoke all on function atlas.reconcile_crop_demand_line_target_trigger_v1() from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_demand_line_target_trigger_v1() to service_role;
drop trigger if exists p9_demand_line_reconcile_crop_target on atlas.flower_demand_order_lines;
create trigger p9_demand_line_reconcile_crop_target after insert or update or delete on atlas.flower_demand_order_lines
for each row execute function atlas.reconcile_crop_demand_line_target_trigger_v1();

create or replace function atlas.reconcile_crop_demand_cancel_target_trigger_v1()
returns trigger language plpgsql security definer set search_path to 'pg_catalog','atlas' as $function$
declare v_order uuid; v_farm uuid;
begin
  v_order:=case when tg_op='DELETE' then old.demand_order_id else new.demand_order_id end;
  select farm_id into v_farm from atlas.flower_demand_orders where id=v_order;
  perform atlas.reconcile_crop_demand_target_match_v1(v_farm,null,null,v_order);
  return case when tg_op='DELETE' then old else new end;
end;
$function$;
revoke all on function atlas.reconcile_crop_demand_cancel_target_trigger_v1() from public,anon,authenticated;
grant execute on function atlas.reconcile_crop_demand_cancel_target_trigger_v1() to service_role;
drop trigger if exists p9_demand_cancel_reconcile_crop_target on atlas.flower_demand_order_cancellation_events;
create trigger p9_demand_cancel_reconcile_crop_target after insert or update or delete on atlas.flower_demand_order_cancellation_events
for each row execute function atlas.reconcile_crop_demand_cancel_target_trigger_v1();

comment on function atlas.reconcile_crop_demand_target_match_v1(uuid,uuid,text,uuid) is
'P9 demand-to-crop reconciliation. Independent demand truth closes or reopens crop harvest commercial-target acquisition without becoming harvestability authority.';