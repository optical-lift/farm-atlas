alter view atlas.flower_ready_inventory_position_v1 set (security_invoker=true);

create table atlas.flower_demand_sale_order_links (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  demand_order_id uuid not null references atlas.flower_demand_orders(id) on delete restrict,
  sale_order_id uuid not null references atlas.flower_sale_orders(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_sale_order_links_pair_unique unique(demand_order_id,sale_order_id)
);
create index flower_demand_sale_order_links_sale_idx on atlas.flower_demand_sale_order_links(sale_order_id);
alter table atlas.flower_demand_sale_order_links enable row level security;
create policy flower_demand_sale_order_links_member_read_v1 on atlas.flower_demand_sale_order_links for select to authenticated using(atlas.is_farm_member(farm_id));
revoke all on atlas.flower_demand_sale_order_links from public,anon,authenticated;
grant select on atlas.flower_demand_sale_order_links to authenticated;
grant all on atlas.flower_demand_sale_order_links to service_role;

create or replace function atlas.validate_flower_demand_sale_order_link_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_demand_farm uuid; v_sale_farm uuid;
begin
  select farm_id into v_demand_farm from atlas.flower_demand_orders where id=new.demand_order_id;
  select farm_id into v_sale_farm from atlas.flower_sale_orders where id=new.sale_order_id;
  if v_demand_farm is null or v_sale_farm is null or v_demand_farm is distinct from new.farm_id or v_sale_farm is distinct from new.farm_id then
    raise exception 'Demand-to-sale order link crosses farm boundaries.' using errcode='22023';
  end if;
  return new;
end; $$;
create trigger flower_demand_sale_order_links_validate_v1 before insert on atlas.flower_demand_sale_order_links for each row execute function atlas.validate_flower_demand_sale_order_link_v1();
create trigger flower_demand_sale_order_links_append_only_v1 before update or delete on atlas.flower_demand_sale_order_links for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
revoke all on function atlas.validate_flower_demand_sale_order_link_v1() from public,anon,authenticated;

create or replace function atlas.record_flower_sale_from_demand_core_v1(
  p_demand_order_id uuid,p_effective_membership_id uuid,p_effective_role text,
  p_tax_amount numeric,p_tip_amount numeric,p_fulfillment_membership_id uuid,p_source_task_id uuid,
  p_note text,p_idempotency_key text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_order atlas.flower_demand_orders%rowtype; v_member atlas.farm_memberships%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_existing_sale uuid; v_sale_result jsonb; v_sale_id uuid;
  v_sale_lines jsonb; v_bad integer; v_release_count integer:=0; v_link_count integer:=0; v_target_line_count integer:=0;
  v_fulfillment_date date; v_fulfillment_time time without time zone;
begin
  if v_key is null then raise exception 'Demand-to-sale idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to convert flower demand to sale.' using errcode='42501'; end if;
  select * into v_order from atlas.flower_demand_orders where id=p_demand_order_id for update;
  if v_order.id is null then raise exception 'Flower demand order not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_order.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if exists(select 1 from atlas.flower_demand_order_cancellation_events where demand_order_id=v_order.id) then raise exception 'Cancelled flower demand cannot become a sale.' using errcode='22023'; end if;
  if v_order.demand_strength<>'committed' then raise exception 'Only committed flower demand may convert to sale.' using errcode='22023'; end if;

  select so.id into v_existing_sale
  from atlas.flower_demand_sale_order_links dsl
  join atlas.flower_sale_orders so on so.id=dsl.sale_order_id
  where dsl.demand_order_id=v_order.id
    and not exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=so.id)
  order by so.created_at desc limit 1;
  if v_existing_sale is not null then
    return jsonb_build_object('demandOrderId',v_order.id,'saleOrderId',v_existing_sale,'deduplicated',true,'coverageState','sold_committed');
  end if;

  select count(*) into v_bad from atlas.flower_demand_coverage_v1 c where c.demand_order_id=v_order.id and (c.coverage_state<>'covered' or c.sold_quantity<>0);
  if v_bad>0 then raise exception 'Demand must be fully reserved, with no active prior sale, before conversion.' using errcode='22023'; end if;
  if not exists(select 1 from atlas.flower_demand_order_lines where demand_order_id=v_order.id) then raise exception 'Demand has no product lines.' using errcode='22023'; end if;
  if exists(select 1 from atlas.flower_demand_order_lines where demand_order_id=v_order.id and target_unit_price is null) then raise exception 'Every demand line requires a target unit price before sale conversion.' using errcode='22023'; end if;

  with active as (
    select a.id as allocation_id,a.ready_lot_id,a.quantity,dl.target_unit_price
    from atlas.flower_demand_allocations a
    join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
    where dl.demand_order_id=v_order.id
      and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
      and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
  ), grouped as (
    select ready_lot_id,sum(quantity) as quantity,min(target_unit_price) as unit_price,max(target_unit_price) as max_unit_price
    from active group by ready_lot_id
  )
  select count(*) filter(where unit_price is distinct from max_unit_price),
         coalesce(jsonb_agg(jsonb_build_object('readyLotId',ready_lot_id,'quantity',quantity,'unitPrice',unit_price) order by ready_lot_id),'[]'::jsonb)
  into v_bad,v_sale_lines from grouped;
  if jsonb_array_length(v_sale_lines)=0 then raise exception 'Covered demand has no active allocations to convert.' using errcode='22023'; end if;
  if v_bad>0 then raise exception 'Allocations sharing one Ready lot must use the same demand unit price.' using errcode='22023'; end if;

  insert into atlas.flower_demand_allocation_release_events(farm_id,allocation_id,reason_kind,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
  select a.farm_id,a.id,'converted_to_sale',null,p_effective_membership_id,v_key||':release:'||a.id::text,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','atomic_demand_to_sale_conversion')
  from atlas.flower_demand_allocations a
  join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
  where dl.demand_order_id=v_order.id
    and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id);
  get diagnostics v_release_count=row_count;

  if v_order.fulfillment_mode='immediate_handoff' then
    v_fulfillment_date:=null; v_fulfillment_time:=null;
  else
    v_fulfillment_date:=v_order.requested_for_date; v_fulfillment_time:=v_order.fulfillment_due_time;
  end if;

  v_sale_result:=atlas.record_flower_sale_core_v2(
    v_order.farm_id,p_effective_membership_id,p_effective_role,v_order.buyer_relationship_id,v_order.customer_label,
    v_order.sales_channel,'demand:'||v_order.id::text,v_sale_lines,coalesce(p_tax_amount,0),coalesce(p_tip_amount,0),
    v_order.fulfillment_mode,v_fulfillment_date,v_fulfillment_time,p_fulfillment_membership_id,p_source_task_id,
    coalesce(nullif(btrim(coalesce(p_note,'')),''),v_order.note),v_key,p_operator_mode
  );
  v_sale_id:=(v_sale_result->>'saleOrderId')::uuid;
  if v_sale_id is null then raise exception 'Demand conversion did not produce a sale order.' using errcode='P0001'; end if;

  insert into atlas.flower_demand_sale_order_links(farm_id,demand_order_id,sale_order_id,metadata)
  values(v_order.farm_id,v_order.id,v_sale_id,jsonb_build_object('truthBoundary','demand_to_sale_provenance','conversionIdempotencyKey',v_key));

  insert into atlas.flower_demand_sale_line_links(farm_id,allocation_id,demand_line_id,sale_order_line_id,quantity,metadata)
  select a.farm_id,a.id,a.demand_line_id,sol.id,a.quantity,jsonb_build_object('truthBoundary','allocation_to_sale_provenance','conversionIdempotencyKey',v_key)
  from atlas.flower_demand_allocations a
  join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
  join atlas.flower_demand_allocation_release_events r on r.allocation_id=a.id and r.idempotency_key=v_key||':release:'||a.id::text
  join atlas.flower_sale_order_lines sol on sol.sale_order_id=v_sale_id and sol.ready_lot_id=a.ready_lot_id
  where dl.demand_order_id=v_order.id;
  get diagnostics v_link_count=row_count;
  select count(*) into v_target_line_count from atlas.flower_demand_allocations a join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id join atlas.flower_demand_allocation_release_events r on r.allocation_id=a.id and r.idempotency_key=v_key||':release:'||a.id::text where dl.demand_order_id=v_order.id;
  if v_link_count<>v_target_line_count or v_link_count<>v_release_count then raise exception 'Demand conversion provenance did not link every released allocation.' using errcode='P0001'; end if;

  return jsonb_build_object('demandOrderId',v_order.id,'saleOrderId',v_sale_id,'sale',v_sale_result,'convertedAllocationCount',v_link_count,'coverageState','sold_committed','deduplicated',false);
end; $$;

create or replace function atlas.record_flower_sale_from_demand_for_member_v1(
  p_farm_id uuid,p_demand_order_id uuid,p_tax_amount numeric,p_tip_amount numeric,p_fulfillment_membership_id uuid,p_source_task_id uuid,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_sale_from_demand_core_v1(p_demand_order_id,v_membership,v_role,p_tax_amount,p_tip_amount,p_fulfillment_membership_id,p_source_task_id,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_sale_from_demand_v1(
  p_effective_membership_id uuid,p_demand_order_id uuid,p_tax_amount numeric,p_tip_amount numeric,p_fulfillment_membership_id uuid,p_source_task_id uuid,p_note text,p_idempotency_key text
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_sale_from_demand_core_v1(p_demand_order_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_tax_amount,p_tip_amount,p_fulfillment_membership_id,p_source_task_id,p_note,p_idempotency_key,true);
end; $$;

revoke all on function atlas.record_flower_sale_from_demand_core_v1(uuid,uuid,text,numeric,numeric,uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_sale_from_demand_core_v1(uuid,uuid,text,numeric,numeric,uuid,uuid,text,text,boolean) to service_role;
revoke all on function atlas.record_flower_sale_from_demand_for_member_v1(uuid,uuid,numeric,numeric,uuid,uuid,text,text),atlas.owner_operator_record_flower_sale_from_demand_v1(uuid,uuid,numeric,numeric,uuid,uuid,text,text) from public,anon;
grant execute on function atlas.record_flower_sale_from_demand_for_member_v1(uuid,uuid,numeric,numeric,uuid,uuid,text,text),atlas.owner_operator_record_flower_sale_from_demand_v1(uuid,uuid,numeric,numeric,uuid,uuid,text,text) to authenticated,service_role;