create or replace view atlas.flower_supply_demand_balance_v1 with (security_invoker=true) as
with committed as (
  select farm_id,inventory_kind,crop_profile_id,unit,
         sum(demanded_quantity) as committed_demand_quantity,
         sum(reserved_quantity) as committed_reserved_quantity,
         sum(sold_quantity) as committed_sold_quantity,
         sum(fulfilled_quantity) as committed_fulfilled_quantity,
         sum(short_quantity) as committed_short_quantity,
         count(distinct demand_order_id) as committed_order_count
  from atlas.flower_demand_coverage_v1
  where demand_strength='committed' and coverage_state<>'cancelled'
  group by farm_id,inventory_kind,crop_profile_id,unit
), requested as (
  select farm_id,inventory_kind,crop_profile_id,unit,
         sum(demanded_quantity) as requested_demand_quantity,
         sum(short_quantity) as requested_short_quantity,
         count(distinct demand_order_id) as requested_order_count
  from atlas.flower_demand_coverage_v1
  where demand_strength='requested' and coverage_state<>'cancelled'
  group by farm_id,inventory_kind,crop_profile_id,unit
), supply as (
  select farm_id,inventory_kind,crop_profile_id,unit,
         sum(birth_quantity) as prepared_quantity,
         sum(available_quantity) as available_quantity,
         sum(demand_reserved_quantity) as demand_reserved_quantity,
         sum(active_claimed_quantity) as sale_committed_quantity,
         sum(fulfilled_quantity) as fulfilled_quantity,
         sum(disposed_quantity) as disposed_quantity,
         count(*) as ready_lot_count
  from atlas.flower_ready_inventory_position_v1
  group by farm_id,inventory_kind,crop_profile_id,unit
), keys as (
  select farm_id,inventory_kind,crop_profile_id,unit from committed
  union
  select farm_id,inventory_kind,crop_profile_id,unit from requested
  union
  select farm_id,inventory_kind,crop_profile_id,unit from supply
)
select k.farm_id,k.inventory_kind,k.crop_profile_id,cp.crop_label,cp.variety,k.unit,
       coalesce(c.committed_order_count,0) as committed_order_count,
       coalesce(c.committed_demand_quantity,0) as committed_demand_quantity,
       coalesce(c.committed_reserved_quantity,0) as committed_reserved_quantity,
       coalesce(c.committed_sold_quantity,0) as committed_sold_quantity,
       coalesce(c.committed_fulfilled_quantity,0) as committed_fulfilled_quantity,
       coalesce(c.committed_short_quantity,0) as committed_short_quantity,
       coalesce(r.requested_order_count,0) as requested_order_count,
       coalesce(r.requested_demand_quantity,0) as requested_demand_quantity,
       coalesce(r.requested_short_quantity,0) as requested_short_quantity,
       coalesce(s.ready_lot_count,0) as ready_lot_count,
       coalesce(s.prepared_quantity,0) as prepared_quantity,
       coalesce(s.available_quantity,0) as available_quantity,
       coalesce(s.demand_reserved_quantity,0) as demand_reserved_quantity,
       coalesce(s.sale_committed_quantity,0) as sale_committed_quantity,
       coalesce(s.fulfilled_quantity,0) as fulfilled_quantity,
       coalesce(s.disposed_quantity,0) as disposed_quantity,
       least(coalesce(c.committed_short_quantity,0),coalesce(s.available_quantity,0)) as immediately_coverable_quantity,
       greatest(coalesce(c.committed_short_quantity,0)-coalesce(s.available_quantity,0),0) as true_short_quantity,
       greatest(coalesce(s.available_quantity,0)-coalesce(c.committed_short_quantity,0),0) as surplus_available_quantity,
       case
         when coalesce(c.committed_short_quantity,0)>coalesce(s.available_quantity,0) then 'short'
         when coalesce(c.committed_short_quantity,0)>0 and coalesce(s.available_quantity,0)>=coalesce(c.committed_short_quantity,0) then 'coverable_unallocated'
         when coalesce(c.committed_short_quantity,0)=0 and coalesce(s.available_quantity,0)>0 then 'surplus_available'
         else 'balanced_no_unallocated'
       end as balance_state
from keys k
left join committed c on c.farm_id=k.farm_id and c.inventory_kind=k.inventory_kind and c.unit=k.unit and c.crop_profile_id is not distinct from k.crop_profile_id
left join requested r on r.farm_id=k.farm_id and r.inventory_kind=k.inventory_kind and r.unit=k.unit and r.crop_profile_id is not distinct from k.crop_profile_id
left join supply s on s.farm_id=k.farm_id and s.inventory_kind=k.inventory_kind and s.unit=k.unit and s.crop_profile_id is not distinct from k.crop_profile_id
left join atlas.crop_profiles cp on cp.id=k.crop_profile_id;

grant select on atlas.flower_supply_demand_balance_v1 to authenticated,service_role;
revoke all on atlas.flower_supply_demand_balance_v1 from anon;