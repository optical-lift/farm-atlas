create or replace function atlas.crop_harvest_commercial_target_state_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_count integer:=0;
  v_targets jsonb:='[]'::jsonb;
  v_relevant boolean:=false;
  v_sources jsonb:='[]'::jsonb;
begin
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  v_relevant:=exists(
    select 1 from atlas.crop_harvest_availability a where a.crop_cycle_id=v_cycle.id and a.status='harvestable'
  ) or v_cycle.harvest_started_date is not null;

  with target_rows as (
    select distinct
      'independent_demand'::text as source_kind,
      d.demand_order_id as source_id,
      d.demand_order_id,
      d.demand_line_id,
      null::uuid as sale_order_id,
      null::uuid as sale_line_id,
      d.buyer_relationship_id,
      d.customer_label,
      d.sales_channel,
      d.requested_for_date as target_date,
      d.demand_strength,
      d.inventory_kind,
      d.crop_profile_id,
      d.product_label,
      d.quantity,
      d.unit,
      null::text as lineage_class
    from atlas.flower_demand_line_position_v1 d
    where d.farm_id=v_cycle.farm_id
      and d.demand_state='open'
      and (
        (v_cycle.crop_profile_id is not null and d.crop_profile_id=v_cycle.crop_profile_id)
        or (
          v_cycle.crop_profile_id is null
          and d.product_label is not null and btrim(d.product_label)<>''
          and lower(regexp_replace(btrim(d.product_label),'\s+',' ','g')) in (
            lower(regexp_replace(btrim(coalesce(v_cycle.variety,'')),'\s+',' ','g')),
            lower(regexp_replace(btrim(coalesce(v_cycle.crop_label,'')),'\s+',' ','g'))
          )
        )
      )

    union all

    select distinct
      'downstream_sale_commitment'::text as source_kind,
      s.id as source_id,
      null::uuid as demand_order_id,
      null::uuid as demand_line_id,
      s.id as sale_order_id,
      sl.id as sale_line_id,
      s.buyer_relationship_id,
      s.customer_label,
      s.sales_channel,
      coalesce(s.fulfillment_due_date,s.sale_date) as target_date,
      'committed'::text as demand_strength,
      sl.inventory_kind,
      r.crop_profile_id,
      r.product_label,
      sl.quantity,
      sl.unit,
      case
        when lineage.input_crop_count=1 then 'direct_single_crop'
        else 'mixed_crops_disposition_proven_revenue_unallocated'
      end as lineage_class
    from atlas.flower_sale_order_lines sl
    join atlas.flower_sale_orders s on s.id=sl.sale_order_id
    join atlas.flower_ready_inventory_lots r on r.id=sl.ready_lot_id
    join lateral (
      select
        count(distinct o.crop_cycle_id) filter (where o.crop_cycle_id is not null) as input_crop_count,
        bool_or(o.crop_cycle_id=v_cycle.id) as includes_this_crop
      from atlas.flower_preparation_inputs pi
      join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
      where pi.preparation_batch_id=r.preparation_batch_id
    ) lineage on true
    where s.farm_id=v_cycle.farm_id
      and lineage.includes_this_crop
      and not exists (
        select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id
      )
  )
  select
    count(*)::integer,
    coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'sourceKind',source_kind,
      'sourceId',source_id,
      'demandOrderId',demand_order_id,
      'demandLineId',demand_line_id,
      'saleOrderId',sale_order_id,
      'saleLineId',sale_line_id,
      'buyerRelationshipId',buyer_relationship_id,
      'customerLabel',customer_label,
      'salesChannel',sales_channel,
      'targetDate',target_date,
      'requestedForDate',case when source_kind='independent_demand' then target_date else null end,
      'demandStrength',demand_strength,
      'inventoryKind',inventory_kind,
      'cropProfileId',crop_profile_id,
      'productLabel',product_label,
      'quantity',quantity,
      'unit',unit,
      'lineageClass',lineage_class
    )) order by target_date nulls last,source_kind,source_id),'[]'::jsonb),
    coalesce(jsonb_agg(distinct source_kind),'[]'::jsonb)
  into v_count,v_targets,v_sources
  from target_rows;

  return jsonb_build_object(
    'contractVersion','crop_harvest_commercial_target_state_v2',
    'cropCycleId',v_cycle.id,
    'relevant',v_relevant,
    'state',case
      when not v_relevant then 'not_yet_relevant'
      when v_count>0 then 'target_established'
      else 'decision_required'
    end,
    'targetCount',v_count,
    'targetSources',v_sources,
    'targets',v_targets,
    'truthBoundary',jsonb_build_object(
      'commercialTargetDoesNotEstablishHarvestability',true,
      'commercialTargetDoesNotBlockBiologicalHarvest',true,
      'noOpenDemandIsACommercialDecisionGapNotProofOfNoFutureBuyer',true,
      'buyerAllocationAndHarvestRequirementAreIndependent',true,
      'attributableDownstreamSaleMayResolveEarlierDispositionGap',true,
      'mixedCropSaleProvesDispositionButDoesNotAuthorizePerCropRevenueAllocation',true,
      'cancelledSaleDoesNotRemainTargetEvidence',true
    )
  );
end;
$function$;

create or replace function atlas.reconcile_crop_commercial_target_from_ready_lot_v1(p_ready_lot_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_crop record;
  v_count integer:=0;
begin
  if p_ready_lot_id is null then return 0; end if;
  for v_crop in
    select distinct o.crop_cycle_id
    from atlas.flower_ready_inventory_lots r
    join atlas.flower_preparation_inputs pi on pi.preparation_batch_id=r.preparation_batch_id
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
    where r.id=p_ready_lot_id and o.crop_cycle_id is not null
  loop
    perform atlas.reconcile_crop_cycle_requirement_state_v1(v_crop.crop_cycle_id);
    v_count:=v_count+1;
  end loop;
  return v_count;
end;
$function$;

create or replace function atlas.reconcile_flower_sale_line_crop_commercial_target_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
begin
  perform atlas.reconcile_crop_commercial_target_from_ready_lot_v1(new.ready_lot_id);
  return new;
end;
$function$;

create or replace function atlas.reconcile_flower_sale_cancel_crop_commercial_target_trigger_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $function$
declare
  v_line record;
begin
  for v_line in
    select distinct sl.ready_lot_id
    from atlas.flower_sale_order_lines sl
    where sl.sale_order_id=new.sale_order_id
  loop
    perform atlas.reconcile_crop_commercial_target_from_ready_lot_v1(v_line.ready_lot_id);
  end loop;
  return new;
end;
$function$;

drop trigger if exists p10_sale_line_crop_commercial_target on atlas.flower_sale_order_lines;
create trigger p10_sale_line_crop_commercial_target
after insert on atlas.flower_sale_order_lines
for each row execute function atlas.reconcile_flower_sale_line_crop_commercial_target_trigger_v1();

drop trigger if exists p10_sale_cancel_crop_commercial_target on atlas.flower_sale_order_cancellation_events;
create trigger p10_sale_cancel_crop_commercial_target
after insert on atlas.flower_sale_order_cancellation_events
for each row execute function atlas.reconcile_flower_sale_cancel_crop_commercial_target_trigger_v1();

revoke all on function atlas.reconcile_crop_commercial_target_from_ready_lot_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.reconcile_crop_commercial_target_from_ready_lot_v1(uuid) to service_role;
revoke all on function atlas.reconcile_flower_sale_line_crop_commercial_target_trigger_v1() from public, anon, authenticated;
grant execute on function atlas.reconcile_flower_sale_line_crop_commercial_target_trigger_v1() to service_role;
revoke all on function atlas.reconcile_flower_sale_cancel_crop_commercial_target_trigger_v1() from public, anon, authenticated;
grant execute on function atlas.reconcile_flower_sale_cancel_crop_commercial_target_trigger_v1() to service_role;

comment on function atlas.crop_harvest_commercial_target_state_v1(uuid) is 'P10 commercial disposition state: independent demand establishes a target before Harvest; an attributable noncancelled downstream sale may resolve the earlier disposition gap after Harvest without becoming harvestability or per-crop revenue authority.';
comment on function atlas.reconcile_crop_commercial_target_from_ready_lot_v1(uuid) is 'Re-evaluates crop requirement/truth-acquisition state when commercial disposition changes on Ready inventory descended from physical Harvest.';