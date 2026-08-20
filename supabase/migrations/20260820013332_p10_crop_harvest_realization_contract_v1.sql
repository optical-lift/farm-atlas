create or replace function atlas.crop_harvest_realization_state_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'pg_catalog','atlas','auth'
as $function$
declare
  v_cycle atlas.crop_cycles%rowtype;
  v_snapshot jsonb;
  v_commercial jsonb;
  v_requirement jsonb;
  v_physical jsonb;
  v_preparation jsonb;
  v_ready jsonb;
  v_sales jsonb;
  v_obs_count integer := 0;
  v_prep_count integer := 0;
  v_ready_count integer := 0;
  v_sale_count integer := 0;
  v_fulfilled_sale_count integer := 0;
  v_direct_ready_count integer := 0;
  v_mixed_ready_count integer := 0;
  v_realization_class text;
begin
  if p_crop_cycle_id is null then
    raise exception 'Crop cycle is required.' using errcode='22023';
  end if;

  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then
    raise exception 'Crop cycle not found.' using errcode='P0002';
  end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;

  v_snapshot := atlas.crop_cycle_requirement_snapshot_v1(v_cycle.id,(now() at time zone 'America/Chicago')::date);
  v_commercial := atlas.crop_harvest_commercial_target_state_v1(v_cycle.id);

  select jsonb_strip_nulls(jsonb_build_object(
      'instanceId',i.id,
      'status',i.status,
      'requirementOnsetDate',i.requirement_onset_date,
      'requirementKnownActiveBy',i.requirement_known_active_by,
      'requirementTimeClass',i.requirement_time_class,
      'releaseGeneration',i.release_generation,
      'carrierTaskId',i.carrier_task_id,
      'releasedAt',i.released_at,
      'resolvedAt',i.resolved_at,
      'epistemicBasis',i.epistemic_basis
    ))
  into v_requirement
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle.id
    and i.consequence_role='operation_requirement'
    and i.action_key='harvest'
  order by case when i.status='open' then 0 else 1 end, i.release_generation desc, i.created_at desc
  limit 1;

  select count(*)::integer,
         jsonb_build_object(
           'observationCount',count(*),
           'bucketEquivalentFloor',coalesce(sum(o.bucket_equivalent_floor),0),
           'containsLowerBound',coalesce(bool_or(o.bucket_band='more_than_one'),false),
           'firstObservedDate',min(o.observed_date),
           'lastObservedDate',max(o.observed_date),
           'moreAvailableStillWitnessed',coalesce(bool_or(coalesce(o.more_available,false)),false),
           'observations',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'observationId',o.id,
             'batchId',o.batch_id,
             'taskId',o.task_id,
             'observedDate',o.observed_date,
             'bucketBand',o.bucket_band,
             'bucketEquivalentFloor',o.bucket_equivalent_floor,
             'moreAvailable',o.more_available,
             'moreAvailability',o.more_availability,
             'note',o.note
           )) order by o.observed_date,o.created_at,o.id),'[]'::jsonb)
         )
  into v_obs_count,v_physical
  from atlas.flower_harvest_bucket_observations o
  where o.crop_cycle_id=v_cycle.id;

  with relevant_preparations as (
    select distinct pb.id,pb.harvest_batch_id,pb.task_id,pb.prepared_date,pb.result_kind,pb.note,pb.created_at
    from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
    join atlas.flower_preparation_batches pb on pb.id=pi.preparation_batch_id
    where o.crop_cycle_id=v_cycle.id
  )
  select count(*)::integer,
         jsonb_build_object(
           'preparationBatchCount',count(*),
           'batches',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'preparationBatchId',rp.id,
             'harvestBatchId',rp.harvest_batch_id,
             'taskId',rp.task_id,
             'preparedDate',rp.prepared_date,
             'resultKind',rp.result_kind,
             'note',rp.note
           )) order by rp.prepared_date,rp.created_at,rp.id),'[]'::jsonb)
         )
  into v_prep_count,v_preparation
  from relevant_preparations rp;

  with relevant_preparations as (
    select distinct pi.preparation_batch_id
    from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
    where o.crop_cycle_id=v_cycle.id
  ),
  ready_lineage as (
    select r.id,r.preparation_batch_id,r.inventory_kind,r.quantity,r.unit,r.quantity_exactness,r.ready_date,
           r.retail_unit_value,r.retail_currency,r.crop_profile_id,r.product_label,r.created_at,
           count(distinct all_o.crop_cycle_id) filter (where all_o.crop_cycle_id is not null) as input_crop_count,
           bool_or(all_o.crop_cycle_id=v_cycle.id) as includes_this_crop
    from relevant_preparations rp
    join atlas.flower_ready_inventory_lots r on r.preparation_batch_id=rp.preparation_batch_id
    left join atlas.flower_preparation_inputs all_pi on all_pi.preparation_batch_id=r.preparation_batch_id
    left join atlas.flower_harvest_bucket_observations all_o on all_o.id=all_pi.harvest_observation_id
    group by r.id,r.preparation_batch_id,r.inventory_kind,r.quantity,r.unit,r.quantity_exactness,r.ready_date,
             r.retail_unit_value,r.retail_currency,r.crop_profile_id,r.product_label,r.created_at
  )
  select count(*)::integer,
         count(*) filter (where input_crop_count=1 and includes_this_crop)::integer,
         count(*) filter (where input_crop_count>1 and includes_this_crop)::integer,
         jsonb_build_object(
           'readyLotCount',count(*),
           'directSingleCropLotCount',count(*) filter (where input_crop_count=1 and includes_this_crop),
           'mixedCropLotCount',count(*) filter (where input_crop_count>1 and includes_this_crop),
           'lots',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'readyLotId',id,
             'preparationBatchId',preparation_batch_id,
             'inventoryKind',inventory_kind,
             'quantity',quantity,
             'unit',unit,
             'quantityExactness',quantity_exactness,
             'readyDate',ready_date,
             'retailUnitValue',retail_unit_value,
             'retailCurrency',retail_currency,
             'cropProfileId',crop_profile_id,
             'productLabel',product_label,
             'lineageClass',case when input_crop_count=1 and includes_this_crop then 'direct_single_crop' when input_crop_count>1 and includes_this_crop then 'mixed_crops_unallocated' else 'lineage_conflict' end,
             'inputCropCount',input_crop_count
           )) order by ready_date,created_at,id),'[]'::jsonb)
         )
  into v_ready_count,v_direct_ready_count,v_mixed_ready_count,v_ready
  from ready_lineage;

  with relevant_preparations as (
    select distinct pi.preparation_batch_id
    from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
    where o.crop_cycle_id=v_cycle.id
  ),
  ready_lineage as (
    select r.id as ready_lot_id,
           count(distinct all_o.crop_cycle_id) filter (where all_o.crop_cycle_id is not null) as input_crop_count,
           bool_or(all_o.crop_cycle_id=v_cycle.id) as includes_this_crop
    from relevant_preparations rp
    join atlas.flower_ready_inventory_lots r on r.preparation_batch_id=rp.preparation_batch_id
    left join atlas.flower_preparation_inputs all_pi on all_pi.preparation_batch_id=r.preparation_batch_id
    left join atlas.flower_harvest_bucket_observations all_o on all_o.id=all_pi.harvest_observation_id
    group by r.id
  ),
  sale_rows as (
    select s.id as sale_order_id,sl.id as sale_line_id,sl.ready_lot_id,sl.quantity,sl.unit,sl.unit_price,
           coalesce(sl.line_total,sl.quantity*sl.unit_price) as line_total,
           s.sale_date,s.customer_label,s.sales_channel,s.fulfillment_due_date,s.currency,
           rl.input_crop_count,
           case when rl.input_crop_count=1 and rl.includes_this_crop then 'direct_single_crop' else 'mixed_crops_unallocated' end as lineage_class,
           exists(select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=s.id) as fulfilled,
           exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id) as cancelled
    from ready_lineage rl
    join atlas.flower_sale_order_lines sl on sl.ready_lot_id=rl.ready_lot_id
    join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  )
  select count(distinct sale_order_id) filter (where not cancelled)::integer,
         count(distinct sale_order_id) filter (where not cancelled and fulfilled)::integer,
         jsonb_build_object(
           'activeSaleOrderCount',count(distinct sale_order_id) filter (where not cancelled),
           'fulfilledSaleOrderCount',count(distinct sale_order_id) filter (where not cancelled and fulfilled),
           'directCommittedRevenue',coalesce(sum(line_total) filter (where not cancelled and lineage_class='direct_single_crop'),0),
           'directRealizedRevenue',coalesce(sum(line_total) filter (where not cancelled and fulfilled and lineage_class='direct_single_crop'),0),
           'mixedLineageRevenueAttributionWithheld',coalesce(sum(line_total) filter (where not cancelled and lineage_class='mixed_crops_unallocated'),0),
           'currencySet',coalesce(jsonb_agg(distinct currency) filter (where not cancelled),'[]'::jsonb),
           'lines',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'saleOrderId',sale_order_id,
             'saleLineId',sale_line_id,
             'readyLotId',ready_lot_id,
             'quantity',quantity,
             'unit',unit,
             'unitPrice',unit_price,
             'lineTotal',line_total,
             'saleDate',sale_date,
             'customerLabel',customer_label,
             'salesChannel',sales_channel,
             'fulfillmentDueDate',fulfillment_due_date,
             'fulfilled',fulfilled,
             'cancelled',cancelled,
             'lineageClass',lineage_class,
             'revenueAttributedToThisCrop',case when lineage_class='direct_single_crop' then line_total else null end
           )) order by sale_date,sale_order_id,sale_line_id),'[]'::jsonb)
         )
  into v_sale_count,v_fulfilled_sale_count,v_sales
  from sale_rows;

  v_realization_class := case
    when v_fulfilled_sale_count>0 then 'fulfilled_commercial_result_exists'
    when v_sale_count>0 then 'sale_committed_waiting_fulfillment'
    when v_ready_count>0 then 'ready_inventory_exists'
    when v_prep_count>0 then 'preparation_recorded_no_ready_inventory_yet'
    when v_obs_count>0 then 'physical_harvest_recorded_waiting_downstream_realization'
    when coalesce(v_requirement->>'status','')='open' then 'harvest_requirement_open_no_physical_output_yet'
    when coalesce((v_commercial->>'relevant')::boolean,false) then 'harvest_relevant_no_physical_output_yet'
    else 'no_current_harvest_realization'
  end;

  return jsonb_build_object(
    'contractVersion','crop_harvest_realization_state_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object(
      'cropCycleId',v_cycle.id,'farmId',v_cycle.farm_id,'cropCycleKey',v_cycle.crop_cycle_key,
      'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,'cropProfileId',v_cycle.crop_profile_id,
      'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status
    )),
    'currentRequirement',jsonb_build_object('snapshot',v_snapshot,'instance',v_requirement),
    'commercialTarget',v_commercial,
    'physicalHarvest',coalesce(v_physical,jsonb_build_object('observationCount',0,'observations','[]'::jsonb)),
    'preparation',coalesce(v_preparation,jsonb_build_object('preparationBatchCount',0,'batches','[]'::jsonb)),
    'readyInventory',coalesce(v_ready,jsonb_build_object('readyLotCount',0,'directSingleCropLotCount',0,'mixedCropLotCount',0,'lots','[]'::jsonb)),
    'commercialRealization',coalesce(v_sales,jsonb_build_object('activeSaleOrderCount',0,'fulfilledSaleOrderCount',0,'directCommittedRevenue',0,'directRealizedRevenue',0,'mixedLineageRevenueAttributionWithheld',0,'lines','[]'::jsonb)),
    'summary',jsonb_build_object(
      'realizationClass',v_realization_class,
      'physicalObservationCount',v_obs_count,
      'preparationBatchCount',v_prep_count,
      'readyLotCount',v_ready_count,
      'directSingleCropReadyLotCount',v_direct_ready_count,
      'mixedCropReadyLotCount',v_mixed_ready_count,
      'activeSaleOrderCount',v_sale_count,
      'fulfilledSaleOrderCount',v_fulfilled_sale_count
    ),
    'truthBoundary',jsonb_build_object(
      'harvestRequirementIsNotPhysicalHarvest',true,
      'commercialTargetDoesNotEstablishHarvestRequirement',true,
      'physicalHarvestDoesNotCreateReadyInventory',true,
      'readyInventoryDoesNotMeanSold',true,
      'saleCommitmentDoesNotMeanFulfilled',true,
      'fulfillmentIsRequiredForRealizedRevenue',true,
      'mixedPreparationDoesNotAuthorizePerCropRevenueAllocation',true,
      'derivedReadOnlyContract',true,
      'existingDomainLedgersRemainAuthority',true
    )
  );
end;
$function$;

revoke all on function atlas.crop_harvest_realization_state_v1(uuid) from public, anon, authenticated;
grant execute on function atlas.crop_harvest_realization_state_v1(uuid) to service_role;
comment on function atlas.crop_harvest_realization_state_v1(uuid) is 'P10 read-only crop-level realization contract over Requirement → physical Harvest → preparation → Ready inventory → sale → fulfillment, withholding per-crop revenue attribution for mixed-crop preparation.';