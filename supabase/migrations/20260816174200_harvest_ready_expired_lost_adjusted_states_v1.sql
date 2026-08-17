alter table atlas.flower_ready_inventory_disposition_events
  drop constraint if exists flower_ready_disposition_kind_check;

alter table atlas.flower_ready_inventory_disposition_events
  add constraint flower_ready_disposition_kind_check
  check (disposition_kind in ('spoilage','expired','lost','donation','write_off','adjusted'));

create or replace function atlas.record_flower_ready_disposition_core_v1(
  p_farm_id uuid,
  p_ready_lot_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_disposition_kind text,
  p_quantity numeric,
  p_note text,
  p_idempotency_key text,
  p_operator_mode boolean default false
) returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.flower_ready_inventory_disposition_events%rowtype;
  v_event atlas.flower_ready_inventory_disposition_events%rowtype;
  v_kind text:=lower(btrim(coalesce(p_disposition_kind,'')));
  v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_available numeric;
begin
  if v_key is null then raise exception 'Ready disposition idempotency key is required.' using errcode='22023'; end if;
  if v_kind not in ('spoilage','expired','lost','donation','write_off','adjusted') then
    raise exception 'Choose a supported Ready disposition.' using errcode='22023';
  end if;
  if p_quantity is null or p_quantity<=0 then raise exception 'Disposition quantity must be positive.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then
    raise exception 'Selected account cannot record Ready disposition.' using errcode='42501';
  end if;
  if p_effective_role='farm_hand' and v_kind not in ('spoilage','expired','lost') then
    raise exception 'Farm Hand may record physical spoilage, expiry, or loss; donation and administrative adjustment require management authority.' using errcode='42501';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from p_farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select * into v_existing
  from atlas.flower_ready_inventory_disposition_events
  where farm_id=p_farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    return jsonb_build_object('dispositionEventId',v_existing.id,'readyLotId',v_existing.ready_lot_id,'deduplicated',true);
  end if;

  select * into v_ready from atlas.flower_ready_inventory_lots where id=p_ready_lot_id for update;
  if v_ready.id is null then raise exception 'Ready inventory lot not found.' using errcode='P0002'; end if;
  if v_ready.farm_id is distinct from p_farm_id then raise exception 'Ready inventory lot is outside this farm.' using errcode='42501'; end if;

  v_available:=atlas.flower_ready_available_quantity_v1(v_ready.id);
  if p_quantity>coalesce(v_available,0) then
    raise exception 'Disposition would remove more than the Ready quantity currently Available.' using errcode='22023';
  end if;

  insert into atlas.flower_ready_inventory_disposition_events(
    farm_id,ready_lot_id,disposition_kind,quantity,unit,note,recorded_by_membership_id,
    idempotency_key,created_by_user_id,metadata
  ) values (
    p_farm_id,v_ready.id,v_kind,p_quantity,v_ready.unit,nullif(btrim(coalesce(p_note,'')),''),
    p_effective_membership_id,v_key,auth.uid(),
    jsonb_build_object(
      'operatorMode',p_operator_mode,
      'truthBoundary','ready_inventory_disposition',
      'inventoryStateClass',case
        when v_kind in ('spoilage','expired','lost') then 'EXPIRED_LOST'
        when v_kind in ('write_off','adjusted') then 'ADJUSTED'
        when v_kind='donation' then 'OTHER_UNAVAILABLE'
      end
    )
  ) returning * into v_event;

  return jsonb_build_object(
    'dispositionEventId',v_event.id,
    'readyLotId',v_ready.id,
    'dispositionKind',v_event.disposition_kind,
    'inventoryStateClass',case
      when v_event.disposition_kind in ('spoilage','expired','lost') then 'EXPIRED_LOST'
      when v_event.disposition_kind in ('write_off','adjusted') then 'ADJUSTED'
      when v_event.disposition_kind='donation' then 'OTHER_UNAVAILABLE'
    end,
    'quantity',v_event.quantity,
    'unit',v_event.unit,
    'availableAfter',atlas.flower_ready_available_quantity_v1(v_ready.id),
    'deduplicated',false
  );
end;
$$;

create or replace view atlas.flower_ready_inventory_state_v1
with (security_invoker=true)
as
with disposition as (
  select
    e.ready_lot_id,
    coalesce(sum(e.quantity) filter (where e.disposition_kind in ('spoilage','expired','lost')),0::numeric) as expired_lost_quantity,
    coalesce(sum(e.quantity) filter (where e.disposition_kind in ('write_off','adjusted')),0::numeric) as adjusted_quantity,
    coalesce(sum(e.quantity) filter (where e.disposition_kind='donation'),0::numeric) as other_unavailable_quantity
  from atlas.flower_ready_inventory_disposition_events e
  group by e.ready_lot_id
)
select
  p.id as ready_lot_id,
  p.farm_id,
  p.preparation_batch_id,
  p.inventory_kind,
  p.crop_profile_id,
  p.product_label,
  p.unit,
  p.birth_quantity,
  p.available_quantity,
  p.demand_reserved_quantity as claimed_quantity,
  greatest(p.active_claimed_quantity-p.fulfilled_quantity,0::numeric) as sold_committed_quantity,
  p.on_prospect_route_quantity,
  p.fulfilled_quantity,
  coalesce(d.expired_lost_quantity,0::numeric) as expired_lost_quantity,
  coalesce(d.adjusted_quantity,0::numeric) as adjusted_quantity,
  coalesce(d.other_unavailable_quantity,0::numeric) as other_unavailable_quantity,
  p.disposed_quantity,
  (
    p.available_quantity
    + p.demand_reserved_quantity
    + greatest(p.active_claimed_quantity-p.fulfilled_quantity,0::numeric)
    + p.on_prospect_route_quantity
    + p.fulfilled_quantity
    + coalesce(d.expired_lost_quantity,0::numeric)
    + coalesce(d.adjusted_quantity,0::numeric)
    + coalesce(d.other_unavailable_quantity,0::numeric)
  ) as state_accounted_quantity,
  abs(p.birth_quantity-(
    p.available_quantity
    + p.demand_reserved_quantity
    + greatest(p.active_claimed_quantity-p.fulfilled_quantity,0::numeric)
    + p.on_prospect_route_quantity
    + p.fulfilled_quantity
    + coalesce(d.expired_lost_quantity,0::numeric)
    + coalesce(d.adjusted_quantity,0::numeric)
    + coalesce(d.other_unavailable_quantity,0::numeric)
  )) < 0.0001 as state_reconciles,
  jsonb_strip_nulls(jsonb_build_object(
    'AVAILABLE',p.available_quantity,
    'CLAIMED',p.demand_reserved_quantity,
    'SOLD_COMMITTED',greatest(p.active_claimed_quantity-p.fulfilled_quantity,0::numeric),
    'ON_PROSPECT_ROUTE',p.on_prospect_route_quantity,
    'FULFILLED',p.fulfilled_quantity,
    'EXPIRED_LOST',coalesce(d.expired_lost_quantity,0::numeric),
    'ADJUSTED',coalesce(d.adjusted_quantity,0::numeric),
    'OTHER_UNAVAILABLE',coalesce(d.other_unavailable_quantity,0::numeric)
  )) as state_quantities
from atlas.flower_ready_inventory_position_v1 p
left join disposition d on d.ready_lot_id=p.id;

grant select on atlas.flower_ready_inventory_state_v1 to authenticated, service_role;

update atlas.authenticated_rpc_registry
set evidence = evidence || jsonb_build_object(
      'inventoryStateTruth','physical spoilage/expiry/loss is distinct from administrative adjustment and donation',
      'supportedDispositions',jsonb_build_array('spoilage','expired','lost','donation','write_off','adjusted')
    ),
    reviewed_at=now()
where signature in (
  'atlas.record_flower_ready_disposition_for_member_v1(uuid, uuid, text, numeric, text, text)',
  'atlas.owner_operator_record_flower_ready_disposition_v1(uuid, uuid, text, numeric, text, text)'
);