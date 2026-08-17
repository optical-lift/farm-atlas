create table atlas.flower_prospect_routes (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  route_date date not null,
  route_label text not null,
  assigned_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  note text null,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_prospect_routes_label_check check(nullif(btrim(route_label),'') is not null),
  constraint flower_prospect_routes_idempotency_unique unique(farm_id,idempotency_key)
);

create table atlas.flower_prospect_route_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  prospect_route_id uuid not null references atlas.flower_prospect_routes(id) on delete restrict,
  ready_lot_id uuid not null references atlas.flower_ready_inventory_lots(id) on delete restrict,
  buyer_relationship_id uuid null references atlas.buyer_relationship_reconstruction(id) on delete restrict,
  destination_label text null,
  quantity numeric(10,2) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_prospect_route_lines_quantity_check check(quantity>0)
);

create table atlas.flower_prospect_route_release_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  prospect_route_line_id uuid not null references atlas.flower_prospect_route_lines(id) on delete restrict,
  reason_kind text not null,
  note text null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_prospect_release_reason_check check(reason_kind=any(array['returned','converted_to_sale','entry_correction','other']::text[])),
  constraint flower_prospect_release_once unique(prospect_route_line_id),
  constraint flower_prospect_release_idempotency_unique unique(farm_id,idempotency_key)
);

create index flower_prospect_routes_farm_date_idx on atlas.flower_prospect_routes(farm_id,route_date);
create index flower_prospect_route_lines_route_idx on atlas.flower_prospect_route_lines(prospect_route_id);
create index flower_prospect_route_lines_ready_idx on atlas.flower_prospect_route_lines(ready_lot_id);
create index flower_prospect_route_lines_buyer_idx on atlas.flower_prospect_route_lines(buyer_relationship_id) where buyer_relationship_id is not null;
create index flower_prospect_release_farm_idx on atlas.flower_prospect_route_release_events(farm_id,created_at);

alter table atlas.flower_prospect_routes enable row level security;
alter table atlas.flower_prospect_route_lines enable row level security;
alter table atlas.flower_prospect_route_release_events enable row level security;
create policy flower_prospect_routes_member_read_v1 on atlas.flower_prospect_routes for select to authenticated using(atlas.is_farm_member(farm_id));
create policy flower_prospect_route_lines_member_read_v1 on atlas.flower_prospect_route_lines for select to authenticated using(atlas.is_farm_member(farm_id));
create policy flower_prospect_release_member_read_v1 on atlas.flower_prospect_route_release_events for select to authenticated using(atlas.is_farm_member(farm_id));
revoke all on atlas.flower_prospect_routes,atlas.flower_prospect_route_lines,atlas.flower_prospect_route_release_events from public,anon,authenticated;
grant select on atlas.flower_prospect_routes,atlas.flower_prospect_route_lines,atlas.flower_prospect_route_release_events to authenticated;
grant all on atlas.flower_prospect_routes,atlas.flower_prospect_route_lines,atlas.flower_prospect_route_release_events to service_role;

create or replace function atlas.validate_flower_prospect_route_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_assignee_farm uuid; v_recorder_farm uuid;
begin
  select farm_id into v_assignee_farm from atlas.farm_memberships where id=new.assigned_membership_id and active=true;
  select farm_id into v_recorder_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_assignee_farm is null or v_recorder_farm is null or v_assignee_farm is distinct from new.farm_id or v_recorder_farm is distinct from new.farm_id then raise exception 'Prospect route assignee and recorder must be active on this farm.' using errcode='22023'; end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_prospect_route_line_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_route_farm uuid; v_ready_farm uuid; v_buyer_farm uuid;
begin
  select farm_id into v_route_farm from atlas.flower_prospect_routes where id=new.prospect_route_id;
  select farm_id into v_ready_farm from atlas.flower_ready_inventory_lots where id=new.ready_lot_id;
  if v_route_farm is null or v_ready_farm is null or v_route_farm is distinct from new.farm_id or v_ready_farm is distinct from new.farm_id then raise exception 'Prospect route line crosses farm boundaries.' using errcode='22023'; end if;
  if new.buyer_relationship_id is not null then
    select farm_id into v_buyer_farm from atlas.buyer_relationship_reconstruction where id=new.buyer_relationship_id;
    if v_buyer_farm is null or v_buyer_farm is distinct from new.farm_id then raise exception 'Prospect destination buyer is outside this farm.' using errcode='22023'; end if;
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_prospect_release_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_line_farm uuid; v_member_farm uuid;
begin
  select farm_id into v_line_farm from atlas.flower_prospect_route_lines where id=new.prospect_route_line_id;
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_line_farm is null or v_member_farm is null or v_line_farm is distinct from new.farm_id or v_member_farm is distinct from new.farm_id then raise exception 'Prospect route release is outside its farm.' using errcode='22023'; end if;
  return new;
end; $$;

create trigger flower_prospect_routes_validate_v1 before insert on atlas.flower_prospect_routes for each row execute function atlas.validate_flower_prospect_route_v1();
create trigger flower_prospect_route_lines_validate_v1 before insert on atlas.flower_prospect_route_lines for each row execute function atlas.validate_flower_prospect_route_line_v1();
create trigger flower_prospect_release_validate_v1 before insert on atlas.flower_prospect_route_release_events for each row execute function atlas.validate_flower_prospect_release_v1();
create trigger flower_prospect_routes_append_only_v1 before update or delete on atlas.flower_prospect_routes for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_prospect_route_lines_append_only_v1 before update or delete on atlas.flower_prospect_route_lines for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_prospect_release_append_only_v1 before update or delete on atlas.flower_prospect_route_release_events for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();

create or replace function atlas.flower_ready_available_quantity_v1(p_ready_lot_id uuid)
returns numeric language sql stable security definer set search_path='pg_catalog','atlas' as $$
  select greatest(0::numeric,
    ready.quantity
    - coalesce((select sum(line.quantity) from atlas.flower_sale_order_lines line join atlas.flower_sale_orders sale on sale.id=line.sale_order_id where line.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)),0::numeric)
    - coalesce((select sum(a.quantity) from atlas.flower_demand_allocations a join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id join atlas.flower_demand_orders d on d.id=dl.demand_order_id where a.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id) and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id)),0::numeric)
    - coalesce((select sum(pl.quantity) from atlas.flower_prospect_route_lines pl where pl.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_prospect_route_release_events pr where pr.prospect_route_line_id=pl.id)),0::numeric)
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
left join lateral (select sum(pl.quantity) as quantity from atlas.flower_prospect_route_lines pl where pl.ready_lot_id=ready.id and not exists(select 1 from atlas.flower_prospect_route_release_events pr where pr.prospect_route_line_id=pl.id)) prospect_claims on true;
alter view atlas.flower_ready_inventory_position_v1 set (security_invoker=true);

create or replace view atlas.flower_prospect_route_position_v1 with (security_invoker=true) as
select r.id as prospect_route_id,r.farm_id,r.route_date,r.route_label,r.assigned_membership_id,r.recorded_by_membership_id,
       l.id as prospect_route_line_id,l.ready_lot_id,ri.inventory_kind,ri.crop_profile_id,ri.crop_label,ri.variety,ri.product_label,l.quantity,ri.unit,
       l.buyer_relationship_id,l.destination_label,
       case when re.id is null then 'on_prospect_route' else case when re.reason_kind='returned' then 'returned' when re.reason_kind='converted_to_sale' then 'converted_to_sale' else 'released' end end as prospect_state,
       re.reason_kind as release_reason,r.created_at
from atlas.flower_prospect_routes r
join atlas.flower_prospect_route_lines l on l.prospect_route_id=r.id
join atlas.flower_ready_inventory_identity_v1 ri on ri.id=l.ready_lot_id
left join atlas.flower_prospect_route_release_events re on re.prospect_route_line_id=l.id;
grant select on atlas.flower_prospect_route_position_v1 to authenticated,service_role;
revoke all on atlas.flower_prospect_route_position_v1 from anon;

revoke all on function atlas.validate_flower_prospect_route_v1(),atlas.validate_flower_prospect_route_line_v1(),atlas.validate_flower_prospect_release_v1() from public,anon,authenticated;