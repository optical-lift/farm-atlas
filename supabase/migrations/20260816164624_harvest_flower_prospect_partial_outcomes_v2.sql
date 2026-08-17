alter table atlas.flower_prospect_route_release_events
  add column quantity numeric(10,2);

update atlas.flower_prospect_route_release_events r
set quantity=l.quantity
from atlas.flower_prospect_route_lines l
where l.id=r.prospect_route_line_id and r.quantity is null;

alter table atlas.flower_prospect_route_release_events
  alter column quantity set not null,
  add constraint flower_prospect_release_quantity_check check(quantity>0),
  drop constraint flower_prospect_release_once;

create index flower_prospect_release_line_idx on atlas.flower_prospect_route_release_events(prospect_route_line_id,created_at);

create or replace function atlas.validate_flower_prospect_release_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare
  v_line atlas.flower_prospect_route_lines%rowtype;
  v_member_farm uuid;
  v_already numeric;
begin
  select * into v_line from atlas.flower_prospect_route_lines where id=new.prospect_route_line_id for update;
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_line.id is null or v_member_farm is null or v_line.farm_id is distinct from new.farm_id or v_member_farm is distinct from new.farm_id then
    raise exception 'Prospect route release is outside its farm.' using errcode='22023';
  end if;
  if new.quantity is null or new.quantity<=0 then raise exception 'Prospect release quantity must be positive.' using errcode='22023'; end if;
  if exists(select 1 from atlas.flower_ready_inventory_lots r where r.id=v_line.ready_lot_id and r.unit='bucket_equivalent') then
    if mod(new.quantity*4,1)<>0 then raise exception 'Prospect bucket release must use quarter-bucket increments.' using errcode='22023'; end if;
  elsif mod(new.quantity,1)<>0 then
    raise exception 'Prospect counted-unit release must be whole numbers.' using errcode='22023';
  end if;
  select coalesce(sum(r.quantity),0) into v_already
  from atlas.flower_prospect_route_release_events r
  where r.prospect_route_line_id=v_line.id;
  if v_already+new.quantity>v_line.quantity then
    raise exception 'Prospect release would exceed quantity still on route.' using errcode='22023';
  end if;
  return new;
end; $$;

create or replace function atlas.flower_ready_available_quantity_v1(p_ready_lot_id uuid)
returns numeric language sql stable security definer set search_path='pg_catalog','atlas' as $$
  select greatest(0::numeric,
    ready.quantity
    - coalesce((select sum(line.quantity) from atlas.flower_sale_order_lines line join atlas.flower_sale_orders sale on sale.id=line.sale_order_id where line.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)),0::numeric)
    - coalesce((select sum(a.quantity) from atlas.flower_demand_allocations a join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id join atlas.flower_demand_orders d on d.id=dl.demand_order_id where a.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id)),0::numeric)
    - coalesce((
        select sum(greatest(pl.quantity-coalesce(rel.released_quantity,0),0))
        from atlas.flower_prospect_route_lines pl
        left join lateral (
          select sum(pr.quantity) as released_quantity
          from atlas.flower_prospect_route_release_events pr
          where pr.prospect_route_line_id=pl.id
        ) rel on true
        where pl.ready_lot_id=ready.id
      ),0::numeric)
    - coalesce((select sum(disposition.quantity) from atlas.flower_ready_inventory_disposition_events disposition where disposition.ready_lot_id=ready.id),0::numeric)
  ) from atlas.flower_ready_inventory_lots ready where ready.id=p_ready_lot_id;
$$;

create or replace view atlas.flower_ready_inventory_position_v1 as
select ready.id,ready.farm_id,ready.preparation_batch_id,ready.inventory_kind,ready.unit,ready.quantity_exactness,ready.ready_date,ready.quantity as birth_quantity,
  coalesce(active_claims.quantity,0::numeric) as active_claimed_quantity,
  coalesce(fulfilled_claims.quantity,0::numeric) as fulfilled_quantity,
  coalesce(disposed.quantity,0::numeric) as disposed_quantity,
  greatest(0::numeric,ready.quantity-coalesce(active_claims.quantity,0::numeric)-coalesce(demand_claims.quantity,0::numeric)-coalesce(prospect_claims.quantity,0::numeric)-coalesce(disposed.quantity,0::numeric)) as available_quantity,
  ready.retail_unit_value,ready.retail_currency,ready.retail_value_source,
  case when ready.retail_unit_value is null then null::numeric else round(ready.quantity*ready.retail_unit_value,2) end as prepared_retail_value,
  case when ready.retail_unit_value is null then null::numeric else round(coalesce(active_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as active_claimed_retail_value,
  case when ready.retail_unit_value is null then null::numeric else round(coalesce(fulfilled_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as fulfilled_retail_value,
  case when ready.retail_unit_value is null then null::numeric else round(coalesce(disposed.quantity,0::numeric)*ready.retail_unit_value,2) end as disposed_retail_value,
  coalesce(active_claims.line_value,0::numeric) as active_committed_product_revenue,
  coalesce(fulfilled_claims.line_value,0::numeric) as realized_product_revenue,
  case when ready.retail_unit_value is null then 'unpriced'::text else 'priced'::text end as valuation_state,
  ready.crop_profile_id,ready.product_label,
  coalesce(demand_claims.quantity,0::numeric) as demand_reserved_quantity,
  case when ready.retail_unit_value is null then null::numeric else round(coalesce(demand_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as demand_reserved_retail_value,
  coalesce(prospect_claims.quantity,0::numeric) as on_prospect_route_quantity,
  case when ready.retail_unit_value is null then null::numeric else round(coalesce(prospect_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as on_prospect_route_retail_value
from atlas.flower_ready_inventory_lots ready
left join lateral (select sum(line.quantity) as quantity,sum(line.line_total) as line_value from atlas.flower_sale_order_lines line join atlas.flower_sale_orders sale on sale.id=line.sale_order_id where line.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)) active_claims on true
left join lateral (select sum(line.quantity) as quantity,sum(line.line_total) as line_value from atlas.flower_sale_order_lines line join atlas.flower_sale_orders sale on sale.id=line.sale_order_id join atlas.flower_fulfillment_events fulfillment on fulfillment.sale_order_id=sale.id where line.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)) fulfilled_claims on true
left join lateral (select sum(disposition.quantity) as quantity from atlas.flower_ready_inventory_disposition_events disposition where disposition.ready_lot_id=ready.id) disposed on true
left join lateral (select sum(a.quantity) as quantity from atlas.flower_demand_allocations a join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id join atlas.flower_demand_orders d on d.id=dl.demand_order_id where a.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id)) demand_claims on true
left join lateral (
  select sum(greatest(pl.quantity-coalesce(rel.released_quantity,0),0)) as quantity
  from atlas.flower_prospect_route_lines pl
  left join lateral (select sum(pr.quantity) as released_quantity from atlas.flower_prospect_route_release_events pr where pr.prospect_route_line_id=pl.id) rel on true
  where pl.ready_lot_id=ready.id
) prospect_claims on true;
alter view atlas.flower_ready_inventory_position_v1 set (security_invoker=true);

create or replace view atlas.flower_prospect_route_position_v1 as
with release as (
  select r.prospect_route_line_id,
         sum(r.quantity) as released_quantity,
         sum(r.quantity) filter(where r.reason_kind='returned') as returned_quantity,
         sum(r.quantity) filter(where r.reason_kind='converted_to_sale') as sold_quantity,
         sum(r.quantity) filter(where r.reason_kind in ('entry_correction','other')) as other_released_quantity,
         string_agg(distinct r.reason_kind,',' order by r.reason_kind) as release_reasons
  from atlas.flower_prospect_route_release_events r
  group by r.prospect_route_line_id
)
select r.id as prospect_route_id,r.farm_id,r.route_date,r.route_label,r.assigned_membership_id,r.recorded_by_membership_id,
       l.id as prospect_route_line_id,l.ready_lot_id,ri.inventory_kind,ri.crop_profile_id,ri.crop_label,ri.variety,ri.product_label,l.quantity,ri.unit,
       l.buyer_relationship_id,l.destination_label,
       case
         when coalesce(rel.released_quantity,0)=0 then 'on_prospect_route'
         when coalesce(rel.released_quantity,0)<l.quantity then 'partially_resolved'
         when coalesce(rel.sold_quantity,0)=l.quantity then 'converted_to_sale'
         when coalesce(rel.returned_quantity,0)=l.quantity then 'returned'
         else 'resolved_mixed'
       end as prospect_state,
       rel.release_reasons as release_reason,
       r.created_at,
       coalesce(rel.released_quantity,0) as released_quantity,
       greatest(l.quantity-coalesce(rel.released_quantity,0),0) as on_prospect_route_quantity,
       coalesce(rel.returned_quantity,0) as returned_quantity,
       coalesce(rel.sold_quantity,0) as sold_quantity,
       coalesce(rel.other_released_quantity,0) as other_released_quantity
from atlas.flower_prospect_routes r
join atlas.flower_prospect_route_lines l on l.prospect_route_id=r.id
join atlas.flower_ready_inventory_identity_v1 ri on ri.id=l.ready_lot_id
left join release rel on rel.prospect_route_line_id=l.id;
alter view atlas.flower_prospect_route_position_v1 set (security_invoker=true);
grant select on atlas.flower_prospect_route_position_v1 to authenticated,service_role;
revoke all on atlas.flower_prospect_route_position_v1 from anon;

create or replace function atlas.release_flower_prospect_route_core_v1(p_prospect_route_id uuid,p_effective_membership_id uuid,p_effective_role text,p_reason_kind text,p_note text,p_idempotency_key text,p_operator_mode boolean default false)
returns jsonb language plpgsql security definer set search_path='pg_catalog','atlas','auth' as $$
declare
  v_route atlas.flower_prospect_routes%rowtype; v_member atlas.farm_memberships%rowtype;
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),''); v_line atlas.flower_prospect_route_lines%rowtype;
  v_count integer:=0; v_remaining numeric; v_released_total numeric:=0;
begin
  if v_key is null then raise exception 'Prospect-route release idempotency key is required.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager') then raise exception 'Owner or Manager authority is required to release prospect-route inventory.' using errcode='42501'; end if;
  if p_reason_kind not in ('returned','entry_correction','other') then raise exception 'Choose a supported manual prospect-route release reason.' using errcode='22023'; end if;
  select * into v_route from atlas.flower_prospect_routes where id=p_prospect_route_id for update;
  if v_route.id is null then raise exception 'Flower prospect route not found.' using errcode='P0002'; end if;
  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_route.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  for v_line in select * from atlas.flower_prospect_route_lines l where l.prospect_route_id=v_route.id order by l.created_at for update loop
    select greatest(v_line.quantity-coalesce(sum(r.quantity),0),0) into v_remaining
    from atlas.flower_prospect_route_release_events r where r.prospect_route_line_id=v_line.id;
    if v_remaining>0 then
      insert into atlas.flower_prospect_route_release_events(farm_id,prospect_route_line_id,reason_kind,quantity,note,recorded_by_membership_id,idempotency_key,created_by_user_id,metadata)
      values(v_route.farm_id,v_line.id,p_reason_kind,v_remaining,nullif(btrim(coalesce(p_note,'')),''),p_effective_membership_id,v_key||':'||v_line.id::text,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'truthBoundary','prospect_custody_release'));
      v_count:=v_count+1; v_released_total:=v_released_total+v_remaining;
    end if;
  end loop;
  return jsonb_build_object('prospectRouteId',v_route.id,'releasedNowLineCount',v_count,'releasedNowQuantity',v_released_total,'deduplicated',v_count=0);
end; $$;