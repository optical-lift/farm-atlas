alter table atlas.flower_ready_inventory_lots
  add column crop_profile_id uuid null references atlas.crop_profiles(id) on delete restrict,
  add column product_label text null;

create index flower_ready_inventory_lots_crop_profile_idx on atlas.flower_ready_inventory_lots(crop_profile_id) where crop_profile_id is not null;

alter table atlas.flower_product_price_book
  add column crop_profile_id uuid null references atlas.crop_profiles(id) on delete restrict;

alter table atlas.flower_product_price_book drop constraint flower_product_price_book_unique;
create unique index flower_product_price_book_identity_unique
  on atlas.flower_product_price_book(farm_id,inventory_kind,unit,crop_profile_id,effective_from) nulls not distinct;
create index flower_product_price_book_crop_profile_idx on atlas.flower_product_price_book(crop_profile_id) where crop_profile_id is not null;

create or replace function atlas.stamp_flower_ready_retail_value_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_price atlas.flower_product_price_book%rowtype;
begin
  select * into v_price
  from atlas.flower_product_price_book p
  where p.farm_id=new.farm_id
    and p.inventory_kind=new.inventory_kind
    and p.unit=new.unit
    and p.effective_from<=new.ready_date
    and (p.crop_profile_id is not distinct from new.crop_profile_id or p.crop_profile_id is null)
  order by
    case when p.crop_profile_id is not distinct from new.crop_profile_id then 0 else 1 end,
    p.effective_from desc,p.created_at desc,p.id
  limit 1;
  if v_price.id is null then
    new.retail_unit_value:=null; new.retail_currency:=null; new.retail_value_source:=null;
  else
    new.retail_unit_value:=v_price.unit_price; new.retail_currency:=v_price.currency;
    new.retail_value_source:='flower_product_price_book:'||v_price.id::text;
  end if;
  return new;
end; $$;

create or replace function atlas.validate_flower_ready_inventory_lot_v1()
returns trigger language plpgsql security definer set search_path='pg_catalog','atlas' as $$
declare v_preparation atlas.flower_preparation_batches%rowtype;
begin
  select * into v_preparation from atlas.flower_preparation_batches where id=new.preparation_batch_id;
  if v_preparation.id is null or v_preparation.farm_id is distinct from new.farm_id then
    raise exception 'Ready inventory preparation does not belong to this farm.' using errcode='22023';
  end if;
  if v_preparation.result_kind<>'ready' then
    raise exception 'A no-saleable-output preparation cannot create Ready inventory.' using errcode='22023';
  end if;
  if not exists (select 1 from atlas.flower_preparation_inputs where preparation_batch_id=v_preparation.id) then
    raise exception 'Ready inventory requires harvested preparation input.' using errcode='22023';
  end if;
  if new.ready_date < v_preparation.prepared_date then
    raise exception 'Ready inventory cannot predate its preparation.' using errcode='22023';
  end if;
  if new.crop_profile_id is not null and not exists (
    select 1
    from atlas.flower_preparation_inputs i
    join atlas.flower_harvest_bucket_observations h on h.id=i.harvest_observation_id
    join atlas.crop_cycles c on c.id=h.crop_cycle_id
    where i.preparation_batch_id=v_preparation.id and c.crop_profile_id=new.crop_profile_id
  ) then
    raise exception 'Ready inventory crop identity is not present in its harvested preparation inputs.' using errcode='22023';
  end if;
  return new;
end; $$;

create or replace view atlas.flower_ready_inventory_identity_v1 with (security_invoker=true) as
select r.id,r.farm_id,r.preparation_batch_id,r.inventory_kind,r.crop_profile_id,
       cp.crop_label,cp.variety,r.product_label,r.quantity,r.unit,r.quantity_exactness,r.ready_date,
       r.retail_unit_value,r.retail_currency,r.retail_value_source,r.metadata,r.created_at
from atlas.flower_ready_inventory_lots r
left join atlas.crop_profiles cp on cp.id=r.crop_profile_id;

grant select on atlas.flower_ready_inventory_identity_v1 to authenticated,service_role;
revoke all on atlas.flower_ready_inventory_identity_v1 from anon;