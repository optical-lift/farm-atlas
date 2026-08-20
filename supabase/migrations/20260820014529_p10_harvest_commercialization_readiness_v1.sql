create or replace function atlas.harvest_commercialization_readiness_v1(p_farm_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_farm_exists boolean;
  v_high_issues integer:=0;
  v_context_issues integer:=0;
  v_physical integer:=0;
  v_preparations integer:=0;
  v_ready integer:=0;
  v_active_sales integer:=0;
  v_fulfillments integer:=0;
  v_full_chain_crops integer:=0;
  v_full_chain_sales integer:=0;
  v_status text;
begin
  if p_farm_id is null then
    raise exception 'Farm is required.' using errcode='22023';
  end if;

  select exists(select 1 from atlas.farms f where f.id=p_farm_id) into v_farm_exists;
  if not v_farm_exists then
    raise exception 'Farm not found.' using errcode='P0002';
  end if;

  if auth.uid() is not null and not atlas.is_farm_member(p_farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  select
    count(*) filter (where severity='high')::integer,
    count(*) filter (where severity='context')::integer
  into v_high_issues,v_context_issues
  from atlas.harvest_realization_continuity_audit_v1(p_farm_id);

  select count(*)::integer into v_physical
  from atlas.flower_harvest_bucket_observations o where o.farm_id=p_farm_id;

  select count(*)::integer into v_preparations
  from atlas.flower_preparation_batches p where p.farm_id=p_farm_id;

  select count(*)::integer into v_ready
  from atlas.flower_ready_inventory_lots r where r.farm_id=p_farm_id;

  select count(*)::integer into v_active_sales
  from atlas.flower_sale_orders s
  where s.farm_id=p_farm_id
    and not exists (
      select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id
    );

  select count(*)::integer into v_fulfillments
  from atlas.flower_fulfillment_events f where f.farm_id=p_farm_id;

  with full_chain as (
    select distinct
      o.crop_cycle_id,
      s.id as sale_order_id
    from atlas.flower_harvest_bucket_observations o
    join atlas.flower_preparation_inputs pi
      on pi.harvest_observation_id=o.id
    join atlas.flower_ready_inventory_lots r
      on r.preparation_batch_id=pi.preparation_batch_id
    join atlas.flower_sale_order_lines sl
      on sl.ready_lot_id=r.id
    join atlas.flower_sale_orders s
      on s.id=sl.sale_order_id
    join atlas.flower_fulfillment_events f
      on f.sale_order_id=s.id
    where o.farm_id=p_farm_id
      and o.crop_cycle_id is not null
      and not exists (
        select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id
      )
  )
  select
    count(distinct crop_cycle_id)::integer,
    count(distinct sale_order_id)::integer
  into v_full_chain_crops,v_full_chain_sales
  from full_chain;

  v_status:=case
    when v_high_issues>0 then 'blocked_continuity'
    when v_full_chain_crops=0 then 'awaiting_genuine_specimen'
    else 'genuine_specimen_observed'
  end;

  return jsonb_build_object(
    'contractVersion','harvest_commercialization_readiness_v1',
    'farmId',p_farm_id,
    'status',v_status,
    'continuity',jsonb_build_object(
      'highIssueCount',v_high_issues,
      'contextIssueCount',v_context_issues,
      'passes',v_high_issues=0
    ),
    'liveEvidence',jsonb_build_object(
      'physicalHarvestObservationCount',v_physical,
      'preparationBatchCount',v_preparations,
      'readyInventoryLotCount',v_ready,
      'activeSaleOrderCount',v_active_sales,
      'fulfillmentEventCount',v_fulfillments,
      'fullChainCropCount',v_full_chain_crops,
      'fullChainSaleCount',v_full_chain_sales
    ),
    'acceptanceBoundary',jsonb_build_object(
      'rollbackProofIsNotProductionEvidence',true,
      'genuinePhysicalHarvestRequired',true,
      'genuinePreparationRequired',true,
      'genuineReadyInventoryRequired',true,
      'genuineNoncancelledSaleRequired',true,
      'genuineFulfillmentRequired',true,
      'continuityMustRemainClean',true,
      'operationalAcceptanceRequiresGenuineFullChainSpecimen',true
    )
  );
end;
$function$;

revoke all on function atlas.harvest_commercialization_readiness_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.harvest_commercialization_readiness_v1(uuid) to service_role;
comment on function atlas.harvest_commercialization_readiness_v1(uuid) is 'P10 release gate separating rollback-proven Harvest commercialization contract from operational acceptance, which requires a genuine farm specimen through physical Harvest → preparation → Ready inventory → noncancelled sale → fulfillment with clean continuity.';