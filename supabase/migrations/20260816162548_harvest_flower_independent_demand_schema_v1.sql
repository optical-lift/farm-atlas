create table atlas.flower_standing_orders (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  buyer_relationship_id uuid null references atlas.buyer_relationship_reconstruction(id) on delete restrict,
  customer_label text null,
  sales_channel text not null,
  fulfillment_mode text not null,
  fulfillment_due_time time without time zone null,
  first_due_date date not null,
  active_end_date date null,
  recurrence_kind text not null default 'weekly',
  recurrence_interval_weeks integer not null default 1,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  note text null,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_standing_orders_channel_check check (sales_channel = any(array['wholesale','farm_pickup','delivery','market','subscription','event','other']::text[])),
  constraint flower_standing_orders_fulfillment_check check (fulfillment_mode = any(array['immediate_handoff','pickup','delivery']::text[])),
  constraint flower_standing_orders_recurrence_check check (recurrence_kind='weekly' and recurrence_interval_weeks between 1 and 52),
  constraint flower_standing_orders_dates_check check (active_end_date is null or active_end_date >= first_due_date),
  constraint flower_standing_orders_customer_check check (buyer_relationship_id is not null or nullif(btrim(customer_label),'') is not null),
  constraint flower_standing_orders_farm_key_unique unique (farm_id,idempotency_key)
);

create table atlas.flower_standing_order_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  standing_order_id uuid not null references atlas.flower_standing_orders(id) on delete restrict,
  inventory_kind text not null,
  crop_profile_id uuid null references atlas.crop_profiles(id) on delete restrict,
  product_label text null,
  quantity numeric(10,2) not null,
  unit text not null,
  target_unit_price numeric(12,2) null,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_standing_order_lines_kind_check check (inventory_kind = any(array['conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement']::text[])),
  constraint flower_standing_order_lines_quantity_check check (quantity > 0),
  constraint flower_standing_order_lines_price_check check (target_unit_price is null or target_unit_price >= 0),
  constraint flower_standing_order_lines_currency_check check (currency='USD'),
  constraint flower_standing_order_lines_semantics_check check (
    (inventory_kind='conditioned_bucket' and unit='bucket_equivalent' and mod(quantity*4,1)=0)
    or (inventory_kind='counted_stems' and unit='stem' and mod(quantity,1)=0)
    or (inventory_kind='posy' and unit='posy' and mod(quantity,1)=0)
    or (inventory_kind='bouquet' and unit='bouquet' and mod(quantity,1)=0)
    or (inventory_kind='lobby_arrangement' and unit='arrangement' and mod(quantity,1)=0)
  )
);

create table atlas.flower_standing_order_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  standing_order_id uuid not null references atlas.flower_standing_orders(id) on delete restrict,
  reason_kind text not null,
  note text null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_standing_order_cancel_reason_check check (reason_kind = any(array['customer_cancelled','seller_cancelled','entry_correction','other']::text[])),
  constraint flower_standing_order_cancel_order_unique unique (standing_order_id),
  constraint flower_standing_order_cancel_idempotency_unique unique (farm_id,idempotency_key)
);

create table atlas.flower_demand_orders (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  buyer_relationship_id uuid null references atlas.buyer_relationship_reconstruction(id) on delete restrict,
  customer_label text null,
  demand_strength text not null,
  sales_channel text not null,
  requested_for_date date not null,
  fulfillment_mode text not null,
  fulfillment_due_time time without time zone null,
  source_standing_order_id uuid null references atlas.flower_standing_orders(id) on delete restrict,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  note text null,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_orders_strength_check check (demand_strength = any(array['requested','committed']::text[])),
  constraint flower_demand_orders_channel_check check (sales_channel = any(array['wholesale','farm_pickup','delivery','market','subscription','event','other']::text[])),
  constraint flower_demand_orders_fulfillment_check check (fulfillment_mode = any(array['immediate_handoff','pickup','delivery']::text[])),
  constraint flower_demand_orders_customer_check check (buyer_relationship_id is not null or nullif(btrim(customer_label),'') is not null),
  constraint flower_demand_orders_farm_key_unique unique (farm_id,idempotency_key)
);

create table atlas.flower_demand_order_lines (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  demand_order_id uuid not null references atlas.flower_demand_orders(id) on delete restrict,
  inventory_kind text not null,
  crop_profile_id uuid null references atlas.crop_profiles(id) on delete restrict,
  product_label text null,
  quantity numeric(10,2) not null,
  unit text not null,
  target_unit_price numeric(12,2) null,
  currency text not null default 'USD',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_order_lines_kind_check check (inventory_kind = any(array['conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement']::text[])),
  constraint flower_demand_order_lines_quantity_check check (quantity > 0),
  constraint flower_demand_order_lines_price_check check (target_unit_price is null or target_unit_price >= 0),
  constraint flower_demand_order_lines_currency_check check (currency='USD'),
  constraint flower_demand_order_lines_semantics_check check (
    (inventory_kind='conditioned_bucket' and unit='bucket_equivalent' and mod(quantity*4,1)=0)
    or (inventory_kind='counted_stems' and unit='stem' and mod(quantity,1)=0)
    or (inventory_kind='posy' and unit='posy' and mod(quantity,1)=0)
    or (inventory_kind='bouquet' and unit='bouquet' and mod(quantity,1)=0)
    or (inventory_kind='lobby_arrangement' and unit='arrangement' and mod(quantity,1)=0)
  )
);

create table atlas.flower_demand_order_cancellation_events (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  demand_order_id uuid not null references atlas.flower_demand_orders(id) on delete restrict,
  reason_kind text not null,
  note text null,
  recorded_by_membership_id uuid not null references atlas.farm_memberships(id) on delete restrict,
  idempotency_key text not null,
  created_by_user_id uuid null default auth.uid(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_demand_order_cancel_reason_check check (reason_kind = any(array['customer_cancelled','seller_cancelled','entry_correction','other']::text[])),
  constraint flower_demand_order_cancel_order_unique unique (demand_order_id),
  constraint flower_demand_order_cancel_idempotency_unique unique (farm_id,idempotency_key)
);

create index flower_standing_orders_farm_due_idx on atlas.flower_standing_orders(farm_id,first_due_date);
create index flower_standing_orders_buyer_idx on atlas.flower_standing_orders(buyer_relationship_id) where buyer_relationship_id is not null;
create index flower_standing_order_lines_order_idx on atlas.flower_standing_order_lines(standing_order_id);
create index flower_standing_order_lines_crop_idx on atlas.flower_standing_order_lines(crop_profile_id) where crop_profile_id is not null;
create index flower_standing_order_cancel_farm_idx on atlas.flower_standing_order_cancellation_events(farm_id,created_at);
create index flower_demand_orders_farm_date_idx on atlas.flower_demand_orders(farm_id,requested_for_date);
create index flower_demand_orders_buyer_idx on atlas.flower_demand_orders(buyer_relationship_id) where buyer_relationship_id is not null;
create index flower_demand_orders_standing_idx on atlas.flower_demand_orders(source_standing_order_id) where source_standing_order_id is not null;
create index flower_demand_order_lines_order_idx on atlas.flower_demand_order_lines(demand_order_id);
create index flower_demand_order_lines_crop_idx on atlas.flower_demand_order_lines(crop_profile_id) where crop_profile_id is not null;
create index flower_demand_order_cancel_farm_idx on atlas.flower_demand_order_cancellation_events(farm_id,created_at);

alter table atlas.flower_standing_orders enable row level security;
alter table atlas.flower_standing_order_lines enable row level security;
alter table atlas.flower_standing_order_cancellation_events enable row level security;
alter table atlas.flower_demand_orders enable row level security;
alter table atlas.flower_demand_order_lines enable row level security;
alter table atlas.flower_demand_order_cancellation_events enable row level security;

create policy flower_standing_orders_member_read_v1 on atlas.flower_standing_orders for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_standing_order_lines_member_read_v1 on atlas.flower_standing_order_lines for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_standing_order_cancel_member_read_v1 on atlas.flower_standing_order_cancellation_events for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_demand_orders_member_read_v1 on atlas.flower_demand_orders for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_demand_order_lines_member_read_v1 on atlas.flower_demand_order_lines for select to authenticated using (atlas.is_farm_member(farm_id));
create policy flower_demand_order_cancel_member_read_v1 on atlas.flower_demand_order_cancellation_events for select to authenticated using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_standing_orders, atlas.flower_standing_order_lines, atlas.flower_standing_order_cancellation_events,
  atlas.flower_demand_orders, atlas.flower_demand_order_lines, atlas.flower_demand_order_cancellation_events from public, anon, authenticated;
grant select on atlas.flower_standing_orders, atlas.flower_standing_order_lines, atlas.flower_standing_order_cancellation_events,
  atlas.flower_demand_orders, atlas.flower_demand_order_lines, atlas.flower_demand_order_cancellation_events to authenticated;
grant all on atlas.flower_standing_orders, atlas.flower_standing_order_lines, atlas.flower_standing_order_cancellation_events,
  atlas.flower_demand_orders, atlas.flower_demand_order_lines, atlas.flower_demand_order_cancellation_events to service_role;

create or replace function atlas.validate_flower_standing_order_v1()
returns trigger language plpgsql set search_path='pg_catalog','atlas' as $$
declare v_farm uuid; v_member_farm uuid;
begin
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_member_farm is null or v_member_farm is distinct from new.farm_id then raise exception 'Standing-order recorder must be an active member of this farm.' using errcode='22023'; end if;
  if new.buyer_relationship_id is not null then
    select farm_id into v_farm from atlas.buyer_relationship_reconstruction where id=new.buyer_relationship_id;
    if v_farm is null or v_farm is distinct from new.farm_id then raise exception 'Standing-order buyer is outside this farm.' using errcode='22023'; end if;
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_standing_order_line_v1()
returns trigger language plpgsql set search_path='pg_catalog','atlas' as $$
declare v_farm uuid;
begin
  select farm_id into v_farm from atlas.flower_standing_orders where id=new.standing_order_id;
  if v_farm is null or v_farm is distinct from new.farm_id then raise exception 'Standing-order line is outside its order farm.' using errcode='22023'; end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_demand_order_v1()
returns trigger language plpgsql set search_path='pg_catalog','atlas' as $$
declare v_farm uuid; v_member_farm uuid;
begin
  select farm_id into v_member_farm from atlas.farm_memberships where id=new.recorded_by_membership_id and active=true;
  if v_member_farm is null or v_member_farm is distinct from new.farm_id then raise exception 'Demand-order recorder must be an active member of this farm.' using errcode='22023'; end if;
  if new.buyer_relationship_id is not null then
    select farm_id into v_farm from atlas.buyer_relationship_reconstruction where id=new.buyer_relationship_id;
    if v_farm is null or v_farm is distinct from new.farm_id then raise exception 'Demand-order buyer is outside this farm.' using errcode='22023'; end if;
  end if;
  if new.source_standing_order_id is not null then
    select farm_id into v_farm from atlas.flower_standing_orders where id=new.source_standing_order_id;
    if v_farm is null or v_farm is distinct from new.farm_id then raise exception 'Demand-order standing source is outside this farm.' using errcode='22023'; end if;
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_demand_order_line_v1()
returns trigger language plpgsql set search_path='pg_catalog','atlas' as $$
declare v_farm uuid;
begin
  select farm_id into v_farm from atlas.flower_demand_orders where id=new.demand_order_id;
  if v_farm is null or v_farm is distinct from new.farm_id then raise exception 'Demand-order line is outside its order farm.' using errcode='22023'; end if;
  return new;
end; $$;

create trigger flower_standing_orders_validate_v1 before insert on atlas.flower_standing_orders for each row execute function atlas.validate_flower_standing_order_v1();
create trigger flower_standing_order_lines_validate_v1 before insert on atlas.flower_standing_order_lines for each row execute function atlas.validate_flower_standing_order_line_v1();
create trigger flower_demand_orders_validate_v1 before insert on atlas.flower_demand_orders for each row execute function atlas.validate_flower_demand_order_v1();
create trigger flower_demand_order_lines_validate_v1 before insert on atlas.flower_demand_order_lines for each row execute function atlas.validate_flower_demand_order_line_v1();

create trigger flower_standing_orders_append_only_v1 before update or delete on atlas.flower_standing_orders for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_standing_order_lines_append_only_v1 before update or delete on atlas.flower_standing_order_lines for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_standing_order_cancel_append_only_v1 before update or delete on atlas.flower_standing_order_cancellation_events for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();
create trigger flower_demand_orders_append_only_v1 before update or delete on atlas.flower_demand_orders for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_demand_order_lines_append_only_v1 before update or delete on atlas.flower_demand_order_lines for each row execute function atlas.prevent_flower_commercial_truth_mutation_v1();
create trigger flower_demand_order_cancel_append_only_v1 before update or delete on atlas.flower_demand_order_cancellation_events for each row execute function atlas.prevent_flower_commercial_reversal_mutation_v1();

create or replace function atlas.flower_demand_line_unit_v1(p_inventory_kind text)
returns text language sql immutable set search_path='pg_catalog','atlas' as $$
  select case p_inventory_kind when 'conditioned_bucket' then 'bucket_equivalent' when 'counted_stems' then 'stem' when 'posy' then 'posy' when 'bouquet' then 'bouquet' when 'lobby_arrangement' then 'arrangement' else null end;
$$;

revoke all on function atlas.validate_flower_standing_order_v1(), atlas.validate_flower_standing_order_line_v1(), atlas.validate_flower_demand_order_v1(), atlas.validate_flower_demand_order_line_v1(), atlas.flower_demand_line_unit_v1(text) from public, anon, authenticated;
grant execute on function atlas.flower_demand_line_unit_v1(text) to service_role;

create or replace view atlas.flower_demand_line_position_v1 with (security_invoker=true) as
select o.id as demand_order_id,o.farm_id,o.buyer_relationship_id,o.customer_label,o.demand_strength,o.sales_channel,o.requested_for_date,o.fulfillment_mode,o.fulfillment_due_time,o.source_standing_order_id,
       l.id as demand_line_id,l.inventory_kind,l.crop_profile_id,l.product_label,l.quantity,l.unit,l.target_unit_price,l.currency,
       case when c.id is not null then 'cancelled' else 'open' end as demand_state,
       case when l.target_unit_price is null then null else round(l.quantity*l.target_unit_price,2) end as target_line_value,
       o.created_at
from atlas.flower_demand_orders o
join atlas.flower_demand_order_lines l on l.demand_order_id=o.id
left join atlas.flower_demand_order_cancellation_events c on c.demand_order_id=o.id;

create or replace view atlas.flower_standing_order_position_v1 with (security_invoker=true) as
with base as (
  select s.*, c.id as cancellation_id, ((now() at time zone 'America/Chicago')::date) as today
  from atlas.flower_standing_orders s left join atlas.flower_standing_order_cancellation_events c on c.standing_order_id=s.id
), due as (
  select b.*,
    case when b.cancellation_id is not null then null::date
      when b.active_end_date is not null and b.today>b.active_end_date then null::date
      when b.today<=b.first_due_date then b.first_due_date
      else b.first_due_date + (((((b.today-b.first_due_date) + (7*b.recurrence_interval_weeks)-1) / (7*b.recurrence_interval_weeks)) * (7*b.recurrence_interval_weeks)))::int end as next_due_date
  from base b
)
select d.id as standing_order_id,d.farm_id,d.buyer_relationship_id,d.customer_label,d.sales_channel,d.fulfillment_mode,d.fulfillment_due_time,d.first_due_date,d.active_end_date,d.recurrence_kind,d.recurrence_interval_weeks,
       case when d.cancellation_id is not null then 'cancelled' when d.active_end_date is not null and d.today>d.active_end_date then 'ended' when d.today<d.first_due_date then 'scheduled' else 'active' end as standing_state,
       d.next_due_date,l.id as standing_line_id,l.inventory_kind,l.crop_profile_id,l.product_label,l.quantity,l.unit,l.target_unit_price,l.currency,
       case when l.target_unit_price is null then null else round(l.quantity*l.target_unit_price,2) end as target_occurrence_line_value,
       d.created_at
from due d join atlas.flower_standing_order_lines l on l.standing_order_id=d.id;

grant select on atlas.flower_demand_line_position_v1, atlas.flower_standing_order_position_v1 to authenticated, service_role;
revoke all on atlas.flower_demand_line_position_v1, atlas.flower_standing_order_position_v1 from anon;