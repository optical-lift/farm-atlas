create table atlas.flower_demand_allocations (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  demand_line_id uuid not null references atlas.flower_demand_order_lines(id) on delete restrict,
  ready_lot_id uuid not null references atlas.flower_ready_inventory_lots(id) on delete restrict,
  quantity numeric(10,2) not null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  note text null,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_allocations_quantity_check check (quantity>0),
  constraint flower_demand_allocations_idempotency_unique unique(farm_id,idempotency_key)
);

create table atlas.flower_demand_allocation_release_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  allocation_id uuid not null references atlas.flower_demand_allocations(id) on delete restrict,
  reason_kind text not null,
  note text null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_allocation_release_reason_check check (reason_kind=any(array['manual_release','converted_to_sale','entry_correction','other']::text[])),
  constraint flower_demand_allocation_release_once unique(allocation_id),
  constraint flower_demand_allocation_release_idempotency_unique unique(farm_id,idempotency_key)
);

create table atlas.flower_demand_sale_line_links (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  allocation_id uuid not null references atlas.flower_demand_allocations(id) on delete restrict,
  demand_line_id uuid not null references atlas.flower_demand_order_lines(id) on delete restrict,
  sale_order_line_id uuid not null references atlas.flower_sale_order_lines(id) on delete restrict,
  quantity numeric(10,2) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_sale_line_links_quantity_check check(quantity>0),
  constraint flower_demand_sale_line_links_allocation_unique unique(allocation_id)
);

create index flower_demand_allocations_line_idx on atlas.flower_demand_allocations(demand_line_id,created_at);
create index flower_demand_allocations_ready_idx on atlas.flower_demand_allocations(ready_lot_id,created_at);
create index flower_demand_allocation_release_farm_idx on atlas.flower_demand_allocation_release_events(farm_id,created_at);
create index flower_demand_sale_links_demand_line_idx on atlas.flower_demand_sale_line_links(demand_line_id);
create index flower_demand_sale_links_sale_line_idx on atlas.flower_demand_sale_line_links(sale_order_line_id);

alter table atlas.flower_demand_allocations enable row level security;
alter table atlas.flower_demand_allocation_release_events enable row level security;
alter table atlas.flower_demand_sale_line_links enable row level security;
create policy flower_demand_allocations_member_read_v1 on atlas.flower_demand_allocations for select to authenticated using(atlas.is_farm_member(farm_id));
create policy flower_demand_allocation_release_member_read_v1 on atlas.flower_demand_allocation_release_events for select to authenticated using(atlas.is_farm_member(farm_id));
create policy flower_demand_sale_links_member_read_v1 on atlas.flower_demand_sale_line_links for select to authenticated using(atlas.is_farm_member(farm_id));
revoke all on atlas.flower_demand_allocations,atlas.flower_demand_allocation_release_events,atlas.flower_demand_sale_line_links from public,anon,authenticated;
grant select on atlas.flower_demand_allocations,atlas.flower_demand_allocation_release_events,atlas.flower_demand_sale_line_links to authenticated;
grant all on atlas.flower_demand_allocations,atlas.flower_demand_allocation_release_events,atlas.flower_demand_sale_line_links to service_role;

create or replace function atlas.validate_flower_demand_allocation_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_line_farm uuid; v_ready_farm uuid; v_member_farm uuid;
begin
  select farm_id into v_line_farm from atlas.flower_demand_order_lines where id=new.demand_line_id;
  select farm_id into v_ready_farm from atlas.flower_ready_inventory_lots where id=new.ready_lot_id;
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_line_farm is null or v_ready_farm is null or v_member_farm is null or v_line_farm is distinct from new.farm_id or v_ready_farm is distinct from new.farm_id or v_member_farm is distinct from new.farm_id then
    raise exception 'Demand allocation line, Ready lot, recorder, and farm must share one farm.' using errcode='22023';
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_demand_allocation_release_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_allocation_farm uuid; v_member_farm uuid;
begin
  select farm_id into v_allocation_farm from atlas.flower_demand_allocations where id=new.allocation_id;
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_allocation_farm is null or v_member_farm is null or v_allocation_farm is distinct from new.farm_id or v_member_farm is distinct from new.farm_id then
    raise exception 'Demand allocation release is outside its farm.' using errcode='22023';
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_demand_sale_line_link_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_allocation atlas.flower_demand_allocations%rowtype; v_demand_farm uuid; v_sale_farm uuid; v_sale_ready uuid;
begin
  select * into v_allocation from atlas.flower_demand_allocations where id=new.allocation_id;
  select farm_id into v_demand_farm from atlas.flower_demand_order_lines where id=new.demand_line_id;
  select farm_id,ready_lot_id into v_sale_farm,v_sale_ready from atlas.flower_sale_order_lines where id=new.sale_order_line_id;
  if v_allocation.id is null or v_demand_farm is null or v_sale_farm is null or v_allocation.farm_id is distinct from new.farm_id or v_demand_farm is distinct from new.farm_id or v_sale_farm is distinct from new.farm_id then
    raise exception 'Demand-to-sale link crosses farm boundaries.' using errcode='22023';
  end if;
  if v_allocation.demand_line_id is distinct from new.demand_line_id or v_allocation.ready_lot_id is distinct from v_sale_ready or v_allocation.quantity is distinct from new.quantity then
    raise exception 'Demand-to-sale link must preserve allocation line, Ready lot, and quantity.' using errcode='22023';
  end if;
  return new;
end; $$;

create trigger flower_demand_allocations_validate_v1 before insert on atlas.flower_demand_allocations for each row execute function atlas.validate_flower_demand_allocation_v1();
create trigger flower_demand_allocation_release_validate_v1 before insert on atlas.flower_demand_allocation_release_events for each row execute function atlas.validate_flower_demand_allocation_release_v1();
create trigger flower_demand_sale_links_validate_v1 before insert on atlas.flower_demand_sale_line_links for each row execute function atlas.validate_flower_demand_sale_line_link_v1();
create trigger flower_demand_allocations_append_only_v1 before update or delete on atlas.flower_demand_allocations for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_demand_allocation_release_append_only_v1 before update or delete on atlas.flower_demand_allocation_release_events for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();
create trigger flower_demand_sale_links_append_only_v1 before update or delete on atlas.flower_demand_sale_line_links for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();

create or replace function atlas.flower_demand_line_remaining_quantity_v1(p_demand_line_id uuid)
returns numeric language sql stable security definer set search_path='pg_catalog','atlas' as $$
  select greatest(0::numeric,
    l.quantity
    - coalesce((
      select sum(a.quantity)
      from atlas.flower_demand_allocations a
      where a.demand_line_id=l.id
        and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
        and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
    ),0::numeric)
    - coalesce((
      select sum(sl.quantity)
      from atlas.flower_demand_sale_line_links sl
      join atlas.flower_sale_order_lines sol on sol.id=sl.sale_order_line_id
      join atlas.flower_sale_orders so on so.id=sol.sale_order_id
      where sl.demand_line_id=l.id
        and not exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=so.id)
    ),0::numeric)
  )
  from atlas.flower_demand_order_lines l
  join atlas.flower_demand_orders o on o.id=l.demand_order_id
  where l.id=p_demand_line_id
    and not exists(select 1 from atlas.flower_demand_order_cancellation_events c where c.demand_order_id=o.id);
$$;

create or replace function atlas.flower_ready_available_quantity_v1(p_ready_lot_id uuid)
returns numeric language sql stable security definer set search_path='pg_catalog','atlas' as $$
  select greatest(0::numeric,
    ready.quantity
    - coalesce((
      select sum(line.quantity)
      from atlas.flower_sale_order_lines line
      join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
      where line.ready_lot_id=ready.id
        and not exists(select 1 from atlas.flower_sale_order_cancellation_events cancellation where cancellation.sale_order_id=sale.id)
    ),0::numeric)
    - coalesce((
      select sum(a.quantity)
      from atlas.flower_demand_allocations a
      join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
      join atlas.flower_demand_orders d on d.id=dl.demand_order_id
      where a.ready_lot_id=ready.id
        and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
        and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
        and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id)
    ),0::numeric)
    - coalesce((select sum(disposition.quantity) from atlas.flower_ready_inventory_disposition_events disposition where disposition.ready_lot_id=ready.id),0::numeric)
  )
  from atlas.flower_ready_inventory_lots ready where ready.id=p_ready_lot_id;
$$;

create or replace view atlas.flower_demand_coverage_v1 with (security_invoker=true) as
with active_allocation as (
  select a.demand_line_id,sum(a.quantity) as quantity
  from atlas.flower_demand_allocations a
  where not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
  group by a.demand_line_id
), sold as (
  select sl.demand_line_id,
         sum(sl.quantity) filter(where c.id is null) as sold_quantity,
         sum(sl.quantity) filter(where c.id is null and f.id is not null) as fulfilled_quantity
  from atlas.flower_demand_sale_line_links sl
  join atlas.flower_sale_order_lines sol on sol.id=sl.sale_order_line_id
  join atlas.flower_sale_orders so on so.id=sol.sale_order_id
  left join atlas.flower_sale_order_cancellation_events c on c.sale_order_id=so.id
  left join atlas.flower_fulfillment_events f on f.sale_order_id=so.id
  group by sl.demand_line_id
)
select o.id as demand_order_id,o.farm_id,o.buyer_relationship_id,o.customer_label,o.demand_strength,o.sales_channel,o.requested_for_date,o.fulfillment_mode,
       l.id as demand_line_id,l.inventory_kind,l.crop_profile_id,l.product_label,l.quantity as demanded_quantity,l.unit,l.target_unit_price,
       case when dc.id is null then coalesce(a.quantity,0) else 0 end as reserved_quantity,
       case when dc.id is null then coalesce(s.sold_quantity,0) else 0 end as sold_quantity,
       case when dc.id is null then coalesce(s.fulfilled_quantity,0) else 0 end as fulfilled_quantity,
       case when dc.id is null then greatest(0,l.quantity-coalesce(a.quantity,0)-coalesce(s.sold_quantity,0)) else 0 end as short_quantity,
       case when dc.id is not null then 'cancelled'
            when coalesce(a.quantity,0)+coalesce(s.sold_quantity,0)=0 then 'uncovered'
            when coalesce(a.quantity,0)+coalesce(s.sold_quantity,0)<l.quantity then 'short'
            when coalesce(a.quantity,0)+coalesce(s.sold_quantity,0)=l.quantity then 'covered'
            else 'overcovered' end as coverage_state,
       case when l.target_unit_price is null then null else round(l.quantity*l.target_unit_price,2) end as target_demand_value
from atlas.flower_demand_orders o
join atlas.flower_demand_order_lines l on l.demand_order_id=o.id
left join atlas.flower_demand_order_cancellation_events dc on dc.demand_order_id=o.id
left join active_allocation a on a.demand_line_id=l.id
left join sold s on s.demand_line_id=l.id;

create or replace view atlas.flower_demand_allocation_position_v1 with (security_invoker=true) as
select a.id as allocation_id,a.farm_id,a.demand_line_id,dl.demand_order_id,a.ready_lot_id,a.quantity,dl.inventory_kind,dl.crop_profile_id,dl.product_label,dl.unit,
       case when sl.id is not null then 'converted_to_sale' when r.id is not null then 'released' when dc.id is not null then 'demand_cancelled' else 'active' end as allocation_state,
       r.reason_kind as release_reason,sl.sale_order_line_id,a.recorded_by_membership_id,a.created_at
from atlas.flower_demand_allocations a
join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
join atlas.flower_demand_orders d on d.id=dl.demand_order_id
left join atlas.flower_demand_order_cancellation_events dc on dc.demand_order_id=d.id
left join atlas.flower_demand_allocation_release_events r on r.allocation_id=a.id
left join atlas.flower_demand_sale_line_links sl on sl.allocation_id=a.id;

grant select on atlas.flower_demand_coverage_v1,atlas.flower_demand_allocation_position_v1 to authenticated,service_role;
revoke all on atlas.flower_demand_coverage_v1,atlas.flower_demand_allocation_position_v1 from anon;

revoke all on function atlas.validate_flower_demand_allocation_v1(),atlas.validate_flower_demand_allocation_release_v1(),atlas.validate_flower_demand_sale_line_link_v1(),atlas.flower_demand_line_remaining_quantity_v1(uuid) from public,anon,authenticated;
grant execute on function atlas.flower_demand_line_remaining_quantity_v1(uuid) to service_role;