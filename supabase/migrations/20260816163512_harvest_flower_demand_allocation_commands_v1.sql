create or replace view atlas.flower_ready_inventory_position_v1 as
select ready.id,
    ready.farm_id,
    ready.preparation_batch_id,
    ready.inventory_kind,
    ready.unit,
    ready.quantity_exactness,
    ready.ready_date,
    ready.quantity as birth_quantity,
    coalesce(active_claims.quantity,0::numeric) as active_claimed_quantity,
    coalesce(fulfilled_claims.quantity,0::numeric) as fulfilled_quantity,
    coalesce(disposed.quantity,0::numeric) as disposed_quantity,
    greatest(0::numeric,ready.quantity-coalesce(active_claims.quantity,0::numeric)-coalesce(demand_claims.quantity,0::numeric)-coalesce(disposed.quantity,0::numeric)) as available_quantity,
    ready.retail_unit_value,
    ready.retail_currency,
    ready.retail_value_source,
    case when ready.retail_unit_value is null then null::numeric else round(ready.quantity*ready.retail_unit_value,2) end as prepared_retail_value,
    case when ready.retail_unit_value is null then null::numeric else round(coalesce(active_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as active_claimed_retail_value,
    case when ready.retail_unit_value is null then null::numeric else round(coalesce(fulfilled_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as fulfilled_retail_value,
    case when ready.retail_unit_value is null then null::numeric else round(coalesce(disposed.quantity,0::numeric)*ready.retail_unit_value,2) end as disposed_retail_value,
    coalesce(active_claims.line_value,0::numeric) as active_committed_product_revenue,
    coalesce(fulfilled_claims.line_value,0::numeric) as realized_product_revenue,
    case when ready.retail_unit_value is null then 'unpriced'::text else 'priced'::text end as valuation_state,
    ready.crop_profile_id,
    ready.product_label,
    coalesce(demand_claims.quantity,0::numeric) as demand_reserved_quantity,
    case when ready.retail_unit_value is null then null::numeric else round(coalesce(demand_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as demand_reserved_retail_value
from atlas.flower_ready_inventory_lots ready
left join lateral (
  select sum(line.quantity) as quantity,sum(line.line_total) as line_value
  from atlas.flower_sale_order_lines line
  join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
  where line.ready_lot_id=ready.id
    and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)
) active_claims on true
left join lateral (
  select sum(line.quantity) as quantity,sum(line.line_total) as line_value
  from atlas.flower_sale_order_lines line
  join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
  join atlas.flower_fulfillment_events fulfillment on fulfillment.sale_order_id=sale.id
  where line.ready_lot_id=ready.id
    and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)
) fulfilled_claims on true
left join lateral (
  select sum(disposition.quantity) as quantity
  from atlas.flower_ready_inventory_disposition_events disposition
  where disposition.ready_lot_id=ready.id
) disposed on true
left join lateral (
  select sum(a.quantity) as quantity
  from atlas.flower_demand_allocations a
  join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
  join atlas.flower_demand_orders d on d.id=dl.demand_order_id
  where a.ready_lot_id=ready.id
    and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id)
) demand_claims on true;

create or replace function atlas.record_flower_demand_allocation_core_v1(
  p_demand_line_id uuid,p_ready_lot_id uuid,p_quantity numeric,
  p_effective_membership_id uuid,p_effective_role text,p_note text,p_idempotency_key text,p_operator_mode boolean default false
) returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_line atlas.flower_demand_order_lines%rowtype; v_order atlas.flower_demand_orders%rowtype; v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_demand_allocations%rowtype; v_allocation atlas.flower_demand_allocations%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_available numeric; v_remaining numeric;
begin
  if v_key is null then raise exception 'Demand allocation idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to allocate flower inventory.' using errcode='42501'; end if;
  select * into v_line from atlas.flower_demand_order_lines where id=p_demand_line_id for update;
  if v_line.id is null then raise exception 'Flower demand line not found.' using errcode='P0002'; end if;
  select * into v_order from atlas.flower_demand_orders where id=v_line.demand_order_id for update;
  if exists(select 1 from atlas.flower_demand_order_cancellation_events where demand_order_id=v_order.id) then raise exception 'Cancelled flower demand cannot receive inventory.' using errcode='22023'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_order.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  select * into v_existing from atlas.flower_demand_allocations where farm_id=v_order.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('allocationId',v_existing.id,'demandLineId',v_existing.demand_line_id,'readyLotId',v_existing.ready_lot_id,'quantity',v_existing.quantity,'deduplicated',true);
  end if;
  select * into v_ready from atlas.flower_ready_inventory_lots where id=p_ready_lot_id for update;
  if v_ready.id is null or v_ready.farm_id is distinct from v_order.farm_id then raise exception 'Ready inventory is outside the demand farm.' using errcode='22023'; end if;
  if v_ready.inventory_kind is distinct from v_line.inventory_kind or v_ready.unit is distinct from v_line.unit then raise exception 'Ready inventory kind/unit does not match the demand line.' using errcode='22023'; end if;
  if v_line.crop_profile_id is not null and v_ready.crop_profile_id is distinct from v_line.crop_profile_id then raise exception 'Ready crop identity does not match the demand crop.' using errcode='22023'; end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Allocation quantity must be positive.' using errcode='22023'; end if;
  if v_line.unit='bucket_equivalent' then
    if mod(p_quantity*4,1)<>0 then raise exception 'Bucket allocation must use quarter-bucket increments.' using errcode='22023'; end if;
  elsif mod(p_quantity,1)<>0 then raise exception 'Counted allocation units must be whole numbers.' using errcode='22023'; end if;
  v_remaining:=atlas.flower_demand_line_remaining_quantity_v1(v_line.id);
  if p_quantity>coalesce(v_remaining,0) then raise exception 'Allocation would exceed the demand quantity still uncovered.' using errcode='22023'; end if;
  v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
  if p_quantity>coalesce(v_available,0) then raise exception 'Allocation would exceed the Ready quantity still Available.' using errcode='22023'; end if;
  insert into atlas.flower_demand_allocations(farm_id,demand_line_id,ready_lot_id,quantity,recorded_by_membership_id,note,idempotency_key,created_by_user_id,metadata)
  values(v_order.farm_id,v_line.id,v_ready.id,p_quantity,p_effective_membership_id,nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','demand_inventory_reservation','saleTruth',false)) returning * into v_allocation;
  return jsonb_build_object('allocationId',v_allocation.id,'demandLineId',v_line.id,'readyLotId',v_ready.id,'quantity',v_allocation.quantity,'remainingDemand',atlas.flower_demand_line_remaining_quantity_v1(v_line.id),'readyAvailable',atlas.flower_ready_available_quantity_v1(v_ready.id),'deduplicated',false);
end; $$;

create or replace function atlas.record_flower_demand_allocation_for_member_v1(p_farm_id uuid,p_demand_line_id uuid,p_ready_lot_id uuid,p_quantity numeric,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.record_flower_demand_allocation_core_v1(p_demand_line_id,p_ready_lot_id,p_quantity,v_membership,v_role,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_record_flower_demand_allocation_v1(p_effective_membership_id uuid,p_demand_line_id uuid,p_ready_lot_id uuid,p_quantity numeric,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.record_flower_demand_allocation_core_v1(p_demand_line_id,p_ready_lot_id,p_quantity,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_note,p_idempotency_key,true);
end; $$;

create or replace function atlas.release_flower_demand_allocation_core_v1(p_allocation_id uuid,p_effective_membership_id uuid,p_effective_role text,p_reason_kind text,p_note text,p_idempotency_key text,p_operator_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_allocation atlas.flower_demand_allocations%rowtype; v_member atlas.farm_memberships%rowtype; v_existing atlas.flower_demand_allocation_release_events%rowtype; v_event atlas.flower_demand_allocation_release_events%rowtype; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
begin
  if v_key is null then raise exception 'Allocation release idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to release flower allocation.' using errcode='42501'; end if;
  if p_reason_kind not in ('manual_release','entry_correction','other') then raise exception 'Choose a supported manual allocation-release reason.' using errcode='22023'; end if;
  select * into v_allocation from atlas.flower_demand_allocations where id=p_allocation_id for update;
  if v_allocation.id is null then raise exception 'Flower demand allocation not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_allocation.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if exists(select 1 from atlas.flower_demand_sale_line_links where allocation_id=v_allocation.id) then raise exception 'A sale-converted allocation cannot be manually released.' using errcode='22023'; end if;
  select * into v_existing from atlas.flower_demand_allocation_release_events where allocation_id=v_allocation.id;
  if v_existing.id is not null then return jsonb_build_object('allocationId',v_allocation.id,'releaseEventId',v_existing.id,'deduplicated',true); end if;
  insert into atlas.flower_demand_allocation_release_events(farm_id,allocation_id,reason_kind,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
  values(v_allocation.farm_id,v_allocation.id,p_reason_kind,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','demand_allocation_release')) returning * into v_event;
  return jsonb_build_object('allocationId',v_allocation.id,'releaseEventId',v_event.id,'readyAvailable',atlas.flower_ready_available_quantity_v1(v_allocation.ready_lot_id),'deduplicated',false);
end; $$;

create or replace function atlas.release_flower_demand_allocation_for_member_v1(p_farm_id uuid,p_allocation_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_role text; v_membership uuid;
begin
  v_role:=atlas.current_farm_role(p_farm_id); v_membership:=atlas.current_membership_id(p_farm_id);
  if auth.uid() is null or v_role is null or v_membership is null then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  return atlas.release_flower_demand_allocation_core_v1(p_allocation_id,v_membership,v_role,p_reason_kind,p_note,p_idempotency_key,false);
end; $$;

create or replace function atlas.owner_operator_release_flower_demand_allocation_v1(p_effective_membership_id uuid,p_allocation_id uuid,p_reason_kind text,p_note text,p_idempotency_key text)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare v_context jsonb;
begin
  v_context:=atlas.owner_operator_context_v1(p_effective_membership_id);
  return atlas.release_flower_demand_allocation_core_v1(p_allocation_id,(v_context#>>'{effective,membershipId}')::uuid,v_context#>>'{effective,role}',p_reason_kind,p_note,p_idempotency_key,true);
end; $$;

revoke all on function atlas.record_flower_demand_allocation_core_v1(uuid,uuid,numeric,uuid,text,text,text,boolean),atlas.release_flower_demand_allocation_core_v1(uuid,uuid,text,text,text,text,boolean) from public,anon,authenticated;
grant execute on function atlas.record_flower_demand_allocation_core_v1(uuid,uuid,numeric,uuid,text,text,text,boolean),atlas.release_flower_demand_allocation_core_v1(uuid,uuid,text,text,text,text,boolean) to service_role;
revoke all on function atlas.record_flower_demand_allocation_for_member_v1(uuid,uuid,uuid,numeric,text,text),atlas.owner_operator_record_flower_demand_allocation_v1(uuid,uuid,uuid,numeric,text,text),atlas.release_flower_demand_allocation_for_member_v1(uuid,uuid,text,text,text),atlas.owner_operator_release_flower_demand_allocation_v1(uuid,uuid,text,text,text) from public,anon;
grant execute on function atlas.record_flower_demand_allocation_for_member_v1(uuid,uuid,uuid,numeric,text,text),atlas.owner_operator_record_flower_demand_allocation_v1(uuid,uuid,uuid,numeric,text,text),atlas.release_flower_demand_allocation_for_member_v1(uuid,uuid,text,text,text),atlas.owner_operator_release_flower_demand_allocation_v1(uuid,uuid,text,text,text) to authenticated,service_role;