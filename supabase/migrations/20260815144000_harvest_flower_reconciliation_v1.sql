-- Harvest Pass 6: reconcile Ready inventory, commercial commitment, realized revenue,
-- and production evidence without introducing a second mutable truth system.

create table atlas.flower_product_price_book (
  id uuid primary key default gen_random_uuid(),
  farm_id uuid not null references atlas.farms(id) on delete restrict,
  inventory_kind text not null,
  unit text not null,
  unit_price numeric(12,2) not null,
  currency text not null default 'USD',
  effective_from date not null,
  source text not null,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint flower_product_price_book_unique unique (farm_id,inventory_kind,unit,effective_from),
  constraint flower_product_price_book_price_check check (unit_price >= 0),
  constraint flower_product_price_book_currency_check check (currency='USD'),
  constraint flower_product_price_book_kind_check check (
    inventory_kind in ('conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement')
  ),
  constraint flower_product_price_book_unit_check check (
    (inventory_kind='conditioned_bucket' and unit='bucket_equivalent') or
    (inventory_kind='counted_stems' and unit='stem') or
    (inventory_kind='posy' and unit='posy') or
    (inventory_kind='bouquet' and unit='bouquet') or
    (inventory_kind='lobby_arrangement' and unit='arrangement')
  )
);

comment on table atlas.flower_product_price_book is
  'Append-only dated default retail valuation for Ready flower products. Sale price remains explicit commercial truth; this book exists only to value prepared output consistently for sell-through.';

create index flower_product_price_book_lookup_idx
  on atlas.flower_product_price_book(farm_id,inventory_kind,unit,effective_from desc);

create or replace function atlas.prevent_flower_product_price_mutation_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  raise exception 'Flower product price-book history is append-only.' using errcode='55000';
end;
$function$;

revoke all on function atlas.prevent_flower_product_price_mutation_v1() from public,anon,authenticated;
grant execute on function atlas.prevent_flower_product_price_mutation_v1() to service_role;

create trigger flower_product_price_book_append_only_v1
before update or delete on atlas.flower_product_price_book
for each row execute function atlas.prevent_flower_product_price_mutation_v1();

alter table atlas.flower_product_price_book enable row level security;
create policy flower_product_price_book_member_read_v1
on atlas.flower_product_price_book
for select to authenticated
using (atlas.is_farm_member(farm_id));

revoke all on atlas.flower_product_price_book from public,anon,authenticated;
grant select on atlas.flower_product_price_book to authenticated;
grant all on atlas.flower_product_price_book to service_role;

insert into atlas.flower_product_price_book(
  farm_id,inventory_kind,unit,unit_price,currency,effective_from,source,note,metadata
)
select f.id,v.inventory_kind,v.unit,v.unit_price,'USD',date '2026-08-15',
       'atlas_harvest_governing_build_2026_08_15',
       'Initial Elm retail valuation from the governing Harvest product catalog.',
       jsonb_build_object('governingProductCatalog',true)
from atlas.farms f
cross join (values
  ('posy'::text,'posy'::text,10.00::numeric),
  ('bouquet'::text,'bouquet'::text,25.00::numeric),
  ('lobby_arrangement'::text,'arrangement'::text,15.00::numeric)
) as v(inventory_kind,unit,unit_price)
where f.stable_key='elm_farm'
on conflict (farm_id,inventory_kind,unit,effective_from) do nothing;

alter table atlas.flower_ready_inventory_lots
  add column retail_unit_value numeric(12,2),
  add column retail_currency text,
  add column retail_value_source text,
  add constraint flower_ready_inventory_lots_retail_value_check check (
    (retail_unit_value is null and retail_currency is null and retail_value_source is null)
    or
    (retail_unit_value >= 0 and retail_currency='USD' and nullif(btrim(retail_value_source),'') is not null)
  );

comment on column atlas.flower_ready_inventory_lots.retail_unit_value is
  'Retail valuation snapshot taken when this Ready birth row is inserted. It is not the eventual sale price.';
comment on column atlas.flower_ready_inventory_lots.retail_value_source is
  'Price-book row identifier/source used for the immutable Ready valuation snapshot.';

create or replace function atlas.stamp_flower_ready_retail_value_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_price atlas.flower_product_price_book%rowtype;
begin
  select * into v_price
  from atlas.flower_product_price_book p
  where p.farm_id=new.farm_id
    and p.inventory_kind=new.inventory_kind
    and p.unit=new.unit
    and p.effective_from<=new.ready_date
  order by p.effective_from desc,p.created_at desc,p.id
  limit 1;

  if v_price.id is null then
    new.retail_unit_value:=null;
    new.retail_currency:=null;
    new.retail_value_source:=null;
  else
    new.retail_unit_value:=v_price.unit_price;
    new.retail_currency:=v_price.currency;
    new.retail_value_source:='flower_product_price_book:'||v_price.id::text;
  end if;
  return new;
end;
$function$;

revoke all on function atlas.stamp_flower_ready_retail_value_v1() from public,anon,authenticated;
grant execute on function atlas.stamp_flower_ready_retail_value_v1() to service_role;

create trigger flower_ready_inventory_lots_00_stamp_retail_v1
before insert on atlas.flower_ready_inventory_lots
for each row execute function atlas.stamp_flower_ready_retail_value_v1();

create view atlas.flower_ready_inventory_position_v1
with (security_invoker=true)
as
select
  ready.id,
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
  greatest(0::numeric,ready.quantity-coalesce(active_claims.quantity,0::numeric)-coalesce(disposed.quantity,0::numeric)) as available_quantity,
  ready.retail_unit_value,
  ready.retail_currency,
  ready.retail_value_source,
  case when ready.retail_unit_value is null then null else round(ready.quantity*ready.retail_unit_value,2) end as prepared_retail_value,
  case when ready.retail_unit_value is null then null else round(coalesce(active_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as active_claimed_retail_value,
  case when ready.retail_unit_value is null then null else round(coalesce(fulfilled_claims.quantity,0::numeric)*ready.retail_unit_value,2) end as fulfilled_retail_value,
  case when ready.retail_unit_value is null then null else round(coalesce(disposed.quantity,0::numeric)*ready.retail_unit_value,2) end as disposed_retail_value,
  coalesce(active_claims.line_value,0::numeric) as active_committed_product_revenue,
  coalesce(fulfilled_claims.line_value,0::numeric) as realized_product_revenue,
  case when ready.retail_unit_value is null then 'unpriced' else 'priced' end as valuation_state
from atlas.flower_ready_inventory_lots ready
left join lateral (
  select sum(line.quantity) as quantity,sum(line.line_total) as line_value
  from atlas.flower_sale_order_lines line
  join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
  where line.ready_lot_id=ready.id
    and not exists (
      select 1 from atlas.flower_sale_order_cancellation_events cancellation
      where cancellation.sale_order_id=sale.id
    )
) active_claims on true
left join lateral (
  select sum(line.quantity) as quantity,sum(line.line_total) as line_value
  from atlas.flower_sale_order_lines line
  join atlas.flower_sale_orders sale on sale.id=line.sale_order_id
  join atlas.flower_fulfillment_events fulfillment on fulfillment.sale_order_id=sale.id
  where line.ready_lot_id=ready.id
    and not exists (
      select 1 from atlas.flower_sale_order_cancellation_events cancellation
      where cancellation.sale_order_id=sale.id
    )
) fulfilled_claims on true
left join lateral (
  select sum(disposition.quantity) as quantity
  from atlas.flower_ready_inventory_disposition_events disposition
  where disposition.ready_lot_id=ready.id
) disposed on true;

comment on view atlas.flower_ready_inventory_position_v1 is
  'Canonical Ready position from immutable birth quantity minus active claims and explicit dispositions, with preserved retail valuation and actual realized line revenue.';

revoke all on atlas.flower_ready_inventory_position_v1 from public,anon,authenticated;
grant select on atlas.flower_ready_inventory_position_v1 to authenticated,service_role;

create view atlas.flower_commercial_farm_score_v1
with (security_invoker=true)
as
with ready as (
  select
    farm_id,
    count(*)::integer as ready_lot_count,
    count(*) filter (where retail_unit_value is null)::integer as unpriced_ready_lot_count,
    coalesce(sum(prepared_retail_value),0::numeric) as priced_prepared_retail_value,
    coalesce(sum(active_claimed_retail_value),0::numeric) as priced_claimed_retail_value,
    coalesce(sum(fulfilled_retail_value),0::numeric) as priced_fulfilled_retail_value,
    coalesce(sum(disposed_retail_value),0::numeric) as priced_disposed_retail_value,
    coalesce(sum(active_committed_product_revenue),0::numeric) as active_committed_product_revenue,
    coalesce(sum(realized_product_revenue),0::numeric) as realized_product_revenue
  from atlas.flower_ready_inventory_position_v1
  group by farm_id
), orders as (
  select
    sale.farm_id,
    count(*) filter (where cancellation.id is null)::integer as active_order_count,
    count(*) filter (where fulfillment.id is not null)::integer as fulfilled_order_count,
    count(*) filter (where cancellation.id is not null)::integer as cancelled_order_count,
    coalesce(sum(sale.subtotal_amount) filter (where cancellation.id is null),0::numeric) as committed_revenue,
    coalesce(sum(sale.subtotal_amount) filter (where fulfillment.id is not null),0::numeric) as realized_revenue,
    coalesce(sum(sale.total_amount) filter (where fulfillment.id is not null),0::numeric) as realized_total_receipts
  from atlas.flower_sale_orders sale
  left join atlas.flower_sale_order_cancellation_events cancellation on cancellation.sale_order_id=sale.id
  left join atlas.flower_fulfillment_events fulfillment on fulfillment.sale_order_id=sale.id
  group by sale.farm_id
)
select
  farm.id as farm_id,
  coalesce(ready.ready_lot_count,0) as ready_lot_count,
  coalesce(ready.unpriced_ready_lot_count,0) as unpriced_ready_lot_count,
  (coalesce(ready.unpriced_ready_lot_count,0)=0) as valuation_complete,
  coalesce(ready.priced_prepared_retail_value,0::numeric) as priced_prepared_retail_value,
  coalesce(ready.priced_claimed_retail_value,0::numeric) as priced_claimed_retail_value,
  coalesce(ready.priced_fulfilled_retail_value,0::numeric) as priced_fulfilled_retail_value,
  coalesce(ready.priced_disposed_retail_value,0::numeric) as priced_disposed_retail_value,
  case
    when coalesce(ready.ready_lot_count,0)=0 then null
    when coalesce(ready.unpriced_ready_lot_count,0)>0 then null
    when coalesce(ready.priced_prepared_retail_value,0)=0 then null
    else round((100*ready.priced_claimed_retail_value/ready.priced_prepared_retail_value)::numeric,1)
  end as sell_through_pct,
  coalesce(orders.active_order_count,0) as active_order_count,
  coalesce(orders.fulfilled_order_count,0) as fulfilled_order_count,
  coalesce(orders.cancelled_order_count,0) as cancelled_order_count,
  coalesce(orders.committed_revenue,0::numeric) as committed_revenue,
  coalesce(orders.realized_revenue,0::numeric) as realized_revenue,
  coalesce(orders.realized_total_receipts,0::numeric) as realized_total_receipts,
  coalesce(ready.active_committed_product_revenue,0::numeric) as active_committed_product_revenue,
  coalesce(ready.realized_product_revenue,0::numeric) as realized_product_revenue
from atlas.farms farm
left join ready on ready.farm_id=farm.id
left join orders on orders.farm_id=farm.id;

comment on view atlas.flower_commercial_farm_score_v1 is
  'Farm-level Harvest commercial score. Sell-through is claimed catalog-valued Ready output divided by prepared catalog-valued Ready output and is withheld when any Ready lot lacks a valuation. Realized revenue requires actual fulfillment.';

revoke all on atlas.flower_commercial_farm_score_v1 from public,anon,authenticated;
grant select on atlas.flower_commercial_farm_score_v1 to authenticated,service_role;

create view atlas.flower_preparation_commercial_evidence_v1
with (security_invoker=true)
as
with source as (
  select
    prep.id as preparation_batch_id,
    prep.farm_id,
    prep.harvest_batch_id,
    prep.prepared_date,
    count(distinct input.harvest_observation_id)::integer as source_observation_count,
    count(distinct harvest.crop_cycle_id)::integer as source_crop_cycle_count,
    coalesce(sum(input.source_bucket_equivalent_floor),0::numeric) as source_bucket_equivalent_floor,
    coalesce(bool_or(input.source_lower_bound),false) as source_has_lower_bound,
    count(distinct plc.crop_cycle_id) filter (where plc.production_lot_id is not null)::integer as linked_crop_cycle_count,
    count(distinct plc.production_lot_id)::integer as production_lot_count,
    array_agg(distinct plc.production_lot_id) filter (where plc.production_lot_id is not null) as production_lot_ids
  from atlas.flower_preparation_batches prep
  join atlas.flower_preparation_inputs input on input.preparation_batch_id=prep.id
  join atlas.flower_harvest_bucket_observations harvest on harvest.id=input.harvest_observation_id
  left join atlas.production_lot_crop_cycles plc on plc.crop_cycle_id=harvest.crop_cycle_id
  group by prep.id,prep.farm_id,prep.harvest_batch_id,prep.prepared_date
), ready as (
  select
    position.preparation_batch_id,
    count(*)::integer as ready_lot_count,
    count(*) filter (where position.retail_unit_value is null)::integer as unpriced_ready_lot_count,
    coalesce(sum(position.prepared_retail_value),0::numeric) as priced_prepared_retail_value,
    coalesce(sum(position.active_claimed_retail_value),0::numeric) as priced_claimed_retail_value,
    coalesce(sum(position.fulfilled_retail_value),0::numeric) as priced_fulfilled_retail_value,
    coalesce(sum(position.realized_product_revenue),0::numeric) as realized_product_revenue
  from atlas.flower_ready_inventory_position_v1 position
  group by position.preparation_batch_id
)
select
  source.preparation_batch_id,
  source.farm_id,
  source.harvest_batch_id,
  source.prepared_date,
  source.source_observation_count,
  source.source_crop_cycle_count,
  source.source_bucket_equivalent_floor,
  source.source_has_lower_bound,
  source.linked_crop_cycle_count,
  source.production_lot_count,
  case
    when source.linked_crop_cycle_count=0 then 'unlinked'
    when source.linked_crop_cycle_count<source.source_crop_cycle_count then 'partial_linkage'
    when source.production_lot_count=1 then 'direct_single_production_lot'
    else 'mixed_production_lots'
  end as production_attribution_state,
  case
    when source.linked_crop_cycle_count=source.source_crop_cycle_count and source.production_lot_count=1
      then source.production_lot_ids[1]
    else null
  end as production_lot_id,
  coalesce(ready.ready_lot_count,0) as ready_lot_count,
  coalesce(ready.unpriced_ready_lot_count,0) as unpriced_ready_lot_count,
  (coalesce(ready.unpriced_ready_lot_count,0)=0) as valuation_complete,
  case when coalesce(ready.unpriced_ready_lot_count,0)=0 then coalesce(ready.priced_prepared_retail_value,0::numeric) else null end as prepared_retail_value,
  case when coalesce(ready.unpriced_ready_lot_count,0)=0 then coalesce(ready.priced_claimed_retail_value,0::numeric) else null end as claimed_retail_value,
  case when coalesce(ready.unpriced_ready_lot_count,0)=0 then coalesce(ready.priced_fulfilled_retail_value,0::numeric) else null end as fulfilled_retail_value,
  coalesce(ready.realized_product_revenue,0::numeric) as realized_product_revenue
from source
left join ready on ready.preparation_batch_id=source.preparation_batch_id;

comment on view atlas.flower_preparation_commercial_evidence_v1 is
  'Internal reconciliation evidence from harvested bucket input through prepared retail value and realized product revenue. Production attribution is explicit and withheld when source lineage is partial or mixed.';

revoke all on atlas.flower_preparation_commercial_evidence_v1 from public,anon,authenticated;
grant select on atlas.flower_preparation_commercial_evidence_v1 to service_role;

create view atlas.flower_harvest_production_evidence_v1
with (security_invoker=true)
as
with production_link as (
  select
    crop_cycle_id,
    count(distinct production_lot_id)::integer as production_lot_count,
    array_agg(distinct production_lot_id) as production_lot_ids
  from atlas.production_lot_crop_cycles
  group by crop_cycle_id
), preparation as (
  select
    input.harvest_observation_id,
    input.preparation_batch_id,
    count(*) over (partition by input.preparation_batch_id)::integer as preparation_source_observation_count
  from atlas.flower_preparation_inputs input
)
select
  harvest.id as harvest_observation_id,
  harvest.farm_id,
  harvest.batch_id as harvest_batch_id,
  harvest.crop_cycle_id,
  harvest.task_id,
  harvest.observed_date,
  harvest.bucket_band,
  harvest.bucket_equivalent_floor,
  (harvest.bucket_band='more_than_one') as harvest_is_lower_bound,
  harvest.more_available,
  coalesce(link.production_lot_count,0) as production_lot_count,
  case
    when coalesce(link.production_lot_count,0)=0 then 'unlinked'
    when link.production_lot_count=1 then 'direct_single_production_lot'
    else 'ambiguous_multiple_production_lots'
  end as production_link_state,
  case when link.production_lot_count=1 then link.production_lot_ids[1] else null end as production_lot_id,
  preparation.preparation_batch_id,
  coalesce(preparation.preparation_source_observation_count,0) as preparation_source_observation_count,
  case
    when preparation.preparation_batch_id is null then 'not_prepared'
    when preparation.preparation_source_observation_count=1 then 'direct_single_observation'
    else 'mixed_batch_unallocated'
  end as conversion_attribution_state,
  case
    when preparation.preparation_source_observation_count=1 then evidence.prepared_retail_value
    else null
  end as directly_attributable_prepared_retail_value,
  case
    when preparation.preparation_source_observation_count=1 then evidence.claimed_retail_value
    else null
  end as directly_attributable_claimed_retail_value,
  case
    when preparation.preparation_source_observation_count=1 then evidence.realized_product_revenue
    else null
  end as directly_attributable_realized_product_revenue
from atlas.flower_harvest_bucket_observations harvest
left join production_link link on link.crop_cycle_id=harvest.crop_cycle_id
left join preparation on preparation.harvest_observation_id=harvest.id
left join atlas.flower_preparation_commercial_evidence_v1 evidence on evidence.preparation_batch_id=preparation.preparation_batch_id;

comment on view atlas.flower_harvest_production_evidence_v1 is
  'Internal Production evidence from actual flower harvest observations. Commercial conversion is attributed to a crop observation only when one preparation batch consumed exactly one harvest observation; mixed batches remain explicitly unallocated.';

revoke all on atlas.flower_harvest_production_evidence_v1 from public,anon,authenticated;
grant select on atlas.flower_harvest_production_evidence_v1 to service_role;
