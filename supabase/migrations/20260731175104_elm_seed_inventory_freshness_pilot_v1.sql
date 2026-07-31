-- Expose Elm's one canonical seed lot as verification-required without inventing a dated count or cadence.

insert into atlas.seed_inventory_state(
  seed_lot_id,organization_id,farm_id,status,verified_on_hand_quantity,unit,
  last_verified_at,last_observed_at,source_event_id,current_task_id,next_check_date,
  low_stock_threshold,note,metadata
)
select
  sl.id,f.organization_id,sl.farm_id,'verification_required',null,sl.quantity_unit,
  null,null,null,null,null,null,
  'Atlas has a confirmed imported quantity but no dated physical-count event. Configure the first recount before relying on this inventory.',
  jsonb_build_object(
    'pilot','elm_seed_inventory_freshness_v1',
    'governed',false,
    'historicalReceiptPreserved',true,
    'physicalCountAuthority','observation_only',
    'importTimestampIsNotCountEvidence',true
  )
from atlas.seed_lots sl
join atlas.farms f on f.id=sl.farm_id
where f.stable_key='elm_farm'
  and sl.stable_key='johnnys_potomac_ivory_1000_existing_inventory'
on conflict(seed_lot_id) do update set
  status=case when atlas.seed_inventory_state.last_verified_at is null then 'verification_required' else atlas.seed_inventory_state.status end,
  unit=excluded.unit,
  note=case when atlas.seed_inventory_state.last_verified_at is null then excluded.note else atlas.seed_inventory_state.note end,
  metadata=atlas.seed_inventory_state.metadata||excluded.metadata,
  updated_at=now();