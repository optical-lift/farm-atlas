-- Preserve exact half-bucket quantities recorded by Weekly Harvest through the
-- existing flower harvest -> preparation lineage. Legacy coarse observations remain valid.

alter table atlas.flower_harvest_bucket_observations
  drop constraint if exists flower_harvest_bucket_observations_floor_check;

alter table atlas.flower_harvest_bucket_observations
  add constraint flower_harvest_bucket_observations_floor_check
  check (
    (bucket_halves is not null and bucket_halves>=1 and bucket_equivalent_floor=(bucket_halves::numeric/2))
    or
    (bucket_halves is null and (
      (bucket_band='quarter' and bucket_equivalent_floor=0.25)
      or (bucket_band='half' and bucket_equivalent_floor=0.50)
      or (bucket_band='three_quarters' and bucket_equivalent_floor=0.75)
      or (bucket_band='one' and bucket_equivalent_floor=1.00)
      or (bucket_band='more_than_one' and bucket_equivalent_floor=1.00)
    ))
  );

create or replace function atlas.validate_flower_preparation_input_v1()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_preparation atlas.flower_preparation_batches%rowtype;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_source_lower_bound boolean;
begin
  select * into v_preparation from atlas.flower_preparation_batches where id=new.preparation_batch_id;
  if v_preparation.id is null or v_preparation.farm_id is distinct from new.farm_id then
    raise exception 'Preparation batch does not belong to this farm.' using errcode='22023';
  end if;

  select * into v_observation from atlas.flower_harvest_bucket_observations where id=new.harvest_observation_id;
  if v_observation.id is null or v_observation.farm_id is distinct from new.farm_id then
    raise exception 'Harvest observation does not belong to this farm.' using errcode='22023';
  end if;
  if v_observation.batch_id is distinct from v_preparation.harvest_batch_id then
    raise exception 'Preparation input is outside the source harvest batch.' using errcode='22023';
  end if;

  v_source_lower_bound := v_observation.bucket_band='more_than_one' and v_observation.bucket_halves is null;
  if new.source_bucket_band is distinct from v_observation.bucket_band
     or new.source_bucket_equivalent_floor is distinct from v_observation.bucket_equivalent_floor
     or new.source_lower_bound is distinct from v_source_lower_bound then
    raise exception 'Preparation input must preserve the harvested physical observation exactly.' using errcode='22023';
  end if;
  return new;
end;
$$;

create or replace function atlas.record_weekly_harvest_row_core_v2(
  p_task_id uuid,
  p_crop_cycle_id uuid,
  p_effective_membership_id uuid,
  p_effective_role text,
  p_result_kind text,
  p_bucket_halves integer,
  p_idempotency_key text,
  p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype;
  v_cycle atlas.crop_cycles%rowtype;
  v_member atlas.farm_memberships%rowtype;
  v_existing atlas.weekly_harvest_task_results%rowtype;
  v_kind text:=lower(btrim(coalesce(p_result_kind,'')));
  v_halves integer:=p_bucket_halves;
  v_band text;
  v_floor numeric(10,2);
  v_today date:=(now() at time zone 'America/Chicago')::date;
  v_next_thursday date;
  v_event atlas.crop_harvest_events%rowtype;
  v_batch_id uuid;
  v_observation atlas.flower_harvest_bucket_observations%rowtype;
  v_result atlas.weekly_harvest_task_results%rowtype;
  v_unresolved integer:=0;
  v_transition jsonb;
  v_next jsonb;
  v_season_end date;
begin
  if v_kind not in ('harvest_amount','not_ready','deadheaded','crop_exhausted') then
    raise exception 'Choose a supported Harvest result.' using errcode='22023';
  end if;
  if nullif(btrim(coalesce(p_idempotency_key,'')),'') is null then
    raise exception 'Harvest idempotency key is required.' using errcode='22023';
  end if;
  if v_kind='harvest_amount' and coalesce(v_halves,0)<1 then
    raise exception 'Harvest amount must be at least one half bucket.' using errcode='22023';
  end if;
  if v_kind<>'harvest_amount' and v_halves is not null then
    raise exception 'Not ready, Deadheaded, and Crop exhausted do not take a harvest amount.' using errcode='22023';
  end if;

  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Weekly Harvest task not found.' using errcode='P0002'; end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'harvest' or v_task.task_series_key<>'anna_harvest_thursday_weekly' then
    raise exception 'Weekly Harvest card is not open.' using errcode='22023';
  end if;

  select * into v_member from atlas.farm_memberships where id=p_effective_membership_id;
  if v_member.id is null or not v_member.active or v_member.farm_id is distinct from v_task.farm_id then
    raise exception 'Active farm membership required.' using errcode='42501';
  end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Harvest access denied.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and v_task.assigned_membership_id is distinct from p_effective_membership_id then
    raise exception 'Weekly Harvest is not assigned to this worker.' using errcode='42501';
  end if;

  select * into v_existing from atlas.weekly_harvest_task_results
  where farm_id=v_task.farm_id and idempotency_key=p_idempotency_key;
  if v_existing.id is null then
    select * into v_existing from atlas.weekly_harvest_task_results where task_id=v_task.id and crop_cycle_id=p_crop_cycle_id;
  end if;
  if v_existing.id is not null then
    return jsonb_build_object(
      'contractVersion','weekly_harvest_round_v2','deduplicated',true,
      'resultId',v_existing.id,'taskId',v_task.id,'cropCycleId',v_existing.crop_cycle_id,
      'resultKind',v_existing.result_kind,'bucketHalves',v_existing.bucket_halves
    );
  end if;

  select cc.* into v_cycle
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  join atlas.crop_cycles cc on cc.id=c.crop_cycle_id
  where c.crop_cycle_id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop is not on this weekly Harvest card.' using errcode='22023'; end if;

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task.id,v_cycle.id,'harvests','confirmed','weekly_harvest_round_v2',jsonb_build_object('weeklyHarvestTaskId',v_task.id))
  on conflict(task_id,crop_cycle_id,role) do nothing;

  v_next_thursday:=v_today + case when ((4-extract(isodow from v_today)::integer+7)%7)=0 then 7 else ((4-extract(isodow from v_today)::integer+7)%7) end;

  if v_kind='harvest_amount' then
    v_band:=case when v_halves=1 then 'half' when v_halves=2 then 'one' else 'more_than_one' end;
    v_floor:=v_halves::numeric/2;

    insert into atlas.flower_harvest_batches(
      farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata,created_by_user_id
    ) values (
      v_task.farm_id,v_today,p_effective_membership_id,'weekly-harvest:'||v_task.id::text,
      jsonb_build_object('physicalOutputMode','half_bucket_counter','precision','half_bucket','weeklyHarvestTaskId',v_task.id),auth.uid()
    )
    on conflict(farm_id,batch_key) do update set updated_at=now()
    returning id into v_batch_id;

    insert into atlas.flower_harvest_bucket_observations(
      farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
      bucket_band,bucket_equivalent_floor,bucket_halves,more_available,note,idempotency_key,
      created_by_user_id,metadata,more_availability
    ) values (
      v_task.farm_id,v_batch_id,v_cycle.id,v_task.id,p_effective_membership_id,v_today,
      v_band,v_floor,v_halves,null,null,p_idempotency_key,auth.uid(),
      jsonb_build_object(
        'physicalOutputMode','half_bucket_counter','precision','half_bucket','weeklyHarvestTaskId',v_task.id,
        'bucketHalves',v_halves,'bucketQuantity',v_floor,'quantityExactness','exact','operatorMode',p_operator_mode
      ),'unsure'
    ) returning * into v_observation;

    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,more_available,note,
      idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'cut','harvested_amount',v_today,null,null,
      p_idempotency_key,auth.uid(),
      jsonb_build_object(
        'weeklyHarvestTaskId',v_task.id,'flowerHarvestBatchId',v_batch_id,
        'flowerHarvestObservationId',v_observation.id,'bucketHalves',v_halves,
        'bucketQuantity',v_floor,'quantityExactness','exact','physicalOutputMode','half_bucket_counter'
      )
    ) returning * into v_event;

    update atlas.crop_cycles
    set harvest_started_date=coalesce(harvest_started_date,v_today),
        last_harvest_date=v_today,
        cycle_state='harvest_watch',
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_harvest_event_id',v_event.id,
          'last_flower_harvest_observation_id',v_observation.id,
          'last_harvest_bucket_halves',v_halves,
          'last_harvest_bucket_quantity',v_floor,
          'physical_output_mode','half_bucket_counter'
        ),
        updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(
      crop_cycle_id,farm_id,status,observed_date,source_event_id,
      current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata
    ) values (
      v_cycle.id,v_task.farm_id,'watching',v_today,v_event.id,null,null,null,null,
      jsonb_build_object(
        'weeklyHarvestTaskId',v_task.id,'lastCutEventId',v_event.id,
        'bucketHalves',v_halves,'bucketQuantity',v_floor,'quantityExactness','exact','physicalOutputMode','half_bucket_counter'
      )
    )
    on conflict(crop_cycle_id) do update
    set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
        current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
        metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  else
    insert into atlas.crop_harvest_events(
      farm_id,crop_cycle_id,task_id,event_kind,outcome,observed_date,next_check_date,note,
      idempotency_key,created_by_user_id,metadata
    ) values (
      v_task.farm_id,v_cycle.id,v_task.id,'watch',v_kind,v_today,
      case when v_kind in ('not_ready','deadheaded') then v_next_thursday else null end,
      null,p_idempotency_key,auth.uid(),
      jsonb_build_object('weeklyHarvestTaskId',v_task.id,'physicalObservationRecorded',true,'operatorMode',p_operator_mode)
    ) returning * into v_event;

    update atlas.crop_cycles
    set cycle_state=case when v_kind='crop_exhausted' then 'finished_harvest' else 'harvest_watch' end,
        metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object(
          'last_harvest_watch_action',v_kind,'last_harvest_watch_date',v_today,'weekly_harvest_task_id',v_task.id
        ),
        updated_at=now()
    where id=v_cycle.id;

    insert into atlas.crop_harvest_availability(
      crop_cycle_id,farm_id,status,observed_date,source_event_id,
      current_watch_task_id,current_watch_occurrence_id,current_harvest_task_id,current_harvest_occurrence_id,metadata
    ) values (
      v_cycle.id,v_task.farm_id,case when v_kind='crop_exhausted' then 'finished' else 'watching' end,
      v_today,v_event.id,null,null,null,null,jsonb_build_object('weeklyHarvestTaskId',v_task.id,'lastAction',v_kind)
    )
    on conflict(crop_cycle_id) do update
    set status=excluded.status,observed_date=excluded.observed_date,source_event_id=excluded.source_event_id,
        current_watch_task_id=null,current_watch_occurrence_id=null,current_harvest_task_id=null,current_harvest_occurrence_id=null,
        metadata=atlas.crop_harvest_availability.metadata||excluded.metadata,updated_at=now();
  end if;

  insert into atlas.weekly_harvest_task_results(
    farm_id,task_id,crop_cycle_id,result_kind,bucket_halves,bucket_band,more_availability,note,
    crop_harvest_event_id,flower_harvest_observation_id,resolved_by_membership_id,idempotency_key,metadata
  ) values (
    v_task.farm_id,v_task.id,v_cycle.id,v_kind,case when v_kind='harvest_amount' then v_halves else null end,
    null,null,null,v_event.id,v_observation.id,p_effective_membership_id,p_idempotency_key,
    jsonb_build_object('operatorMode',p_operator_mode,'contractVersion','weekly_harvest_round_v2')
  ) returning * into v_result;

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle.id);

  select count(*)::integer into v_unresolved
  from atlas.weekly_harvest_candidate_cycles_v1(v_task.id) c
  left join atlas.weekly_harvest_task_results r on r.task_id=v_task.id and r.crop_cycle_id=c.crop_cycle_id
  where r.id is null;

  if v_unresolved=0 and exists(select 1 from atlas.weekly_harvest_task_results where task_id=v_task.id) then
    v_transition:=atlas.record_task_transition_v1_internal(
      v_task.id,'done','weekly-harvest:auto:v2:'||v_task.id::text,null,
      'Every crop on this week''s Harvest card was physically resolved.',null,'harvest','weekly_harvest_round',
      jsonb_build_object('completion_source','weekly_harvest_crop_results_v2','last_result_id',v_result.id),null
    );
    begin v_season_end:=nullif(v_task.metadata->>'season_end','')::date; exception when others then v_season_end:=date '2026-11-12'; end;
    v_season_end:=coalesce(v_season_end,date '2026-11-12');
    if v_task.due_date is not null and v_task.due_date+7<=v_season_end then
      v_next:=atlas.ensure_weekly_harvest_card_v1(v_task.farm_id,v_task.due_date+7);
    end if;
  end if;

  return jsonb_build_object(
    'contractVersion','weekly_harvest_round_v2','deduplicated',false,
    'resultId',v_result.id,'taskId',v_task.id,'cropCycleId',v_cycle.id,
    'resultKind',v_kind,'bucketHalves',case when v_kind='harvest_amount' then v_halves else null end,
    'bucketQuantity',case when v_kind='harvest_amount' then v_floor else null end,
    'remainingRows',v_unresolved,'taskCompleted',v_transition is not null,'nextWeeklyCard',v_next
  );
end;
$$;

-- Treat legacy "more_than_one" as a lower bound only when no exact half-bucket
-- quantity accompanies the observation.
create or replace function atlas.crop_harvest_realization_state_v1(p_crop_cycle_id uuid)
returns jsonb
language plpgsql
stable security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
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
  if p_crop_cycle_id is null then raise exception 'Crop cycle is required.' using errcode='22023'; end if;
  select * into v_cycle from atlas.crop_cycles where id=p_crop_cycle_id;
  if v_cycle.id is null then raise exception 'Crop cycle not found.' using errcode='P0002'; end if;
  if auth.uid() is not null and not atlas.is_farm_member(v_cycle.farm_id) then raise exception 'Active farm membership required.' using errcode='42501'; end if;

  v_snapshot := atlas.crop_cycle_requirement_snapshot_v1(v_cycle.id,(now() at time zone 'America/Chicago')::date);
  v_commercial := atlas.crop_harvest_commercial_target_state_v1(v_cycle.id);

  select jsonb_strip_nulls(jsonb_build_object(
      'instanceId',i.id,'status',i.status,'requirementOnsetDate',i.requirement_onset_date,
      'requirementKnownActiveBy',i.requirement_known_active_by,'requirementTimeClass',i.requirement_time_class,
      'releaseGeneration',i.release_generation,'carrierTaskId',i.carrier_task_id,'releasedAt',i.released_at,
      'resolvedAt',i.resolved_at,'epistemicBasis',i.epistemic_basis
    ))
  into v_requirement
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle' and i.subject_id=v_cycle.id
    and i.consequence_role='operation_requirement' and i.action_key='harvest'
  order by case when i.status='open' then 0 else 1 end,i.release_generation desc,i.created_at desc limit 1;

  select count(*)::integer,
         jsonb_build_object(
           'observationCount',count(*),
           'bucketEquivalentFloor',coalesce(sum(o.bucket_equivalent_floor),0),
           'containsLowerBound',coalesce(bool_or(o.bucket_band='more_than_one' and o.bucket_halves is null),false),
           'firstObservedDate',min(o.observed_date),'lastObservedDate',max(o.observed_date),
           'moreAvailableStillWitnessed',coalesce(bool_or(coalesce(o.more_available,false)),false),
           'observations',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'observationId',o.id,'batchId',o.batch_id,'taskId',o.task_id,'observedDate',o.observed_date,
             'bucketBand',o.bucket_band,'bucketHalves',o.bucket_halves,'bucketQuantity',o.bucket_equivalent_floor,
             'quantityExactness',case when o.bucket_halves is not null then 'exact' when o.bucket_band='more_than_one' then 'lower_bound' else 'band_floor' end,
             'moreAvailable',o.more_available,'moreAvailability',o.more_availability,'note',o.note
           )) order by o.observed_date,o.created_at,o.id),'[]'::jsonb)
         )
  into v_obs_count,v_physical
  from atlas.flower_harvest_bucket_observations o where o.crop_cycle_id=v_cycle.id;

  with relevant_preparations as (
    select distinct pb.id,pb.harvest_batch_id,pb.task_id,pb.prepared_date,pb.result_kind,pb.note,pb.created_at
    from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
    join atlas.flower_preparation_batches pb on pb.id=pi.preparation_batch_id
    where o.crop_cycle_id=v_cycle.id
  )
  select count(*)::integer,jsonb_build_object(
      'preparationBatchCount',count(*),'batches',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
        'preparationBatchId',rp.id,'harvestBatchId',rp.harvest_batch_id,'taskId',rp.task_id,
        'preparedDate',rp.prepared_date,'resultKind',rp.result_kind,'note',rp.note
      )) order by rp.prepared_date,rp.created_at,rp.id),'[]'::jsonb)
    ) into v_prep_count,v_preparation from relevant_preparations rp;

  with relevant_preparations as (
    select distinct pi.preparation_batch_id from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id where o.crop_cycle_id=v_cycle.id
  ), ready_lineage as (
    select r.id,r.preparation_batch_id,r.inventory_kind,r.quantity,r.unit,r.quantity_exactness,r.ready_date,
           r.retail_unit_value,r.retail_currency,r.crop_profile_id,r.product_label,r.created_at,
           count(distinct all_o.crop_cycle_id) filter (where all_o.crop_cycle_id is not null) as input_crop_count,
           bool_or(all_o.crop_cycle_id=v_cycle.id) as includes_this_crop
    from relevant_preparations rp join atlas.flower_ready_inventory_lots r on r.preparation_batch_id=rp.preparation_batch_id
    left join atlas.flower_preparation_inputs all_pi on all_pi.preparation_batch_id=r.preparation_batch_id
    left join atlas.flower_harvest_bucket_observations all_o on all_o.id=all_pi.harvest_observation_id
    group by r.id,r.preparation_batch_id,r.inventory_kind,r.quantity,r.unit,r.quantity_exactness,r.ready_date,
             r.retail_unit_value,r.retail_currency,r.crop_profile_id,r.product_label,r.created_at
  )
  select count(*)::integer,count(*) filter (where input_crop_count=1 and includes_this_crop)::integer,
         count(*) filter (where input_crop_count>1 and includes_this_crop)::integer,
         jsonb_build_object('readyLotCount',count(*),
           'directSingleCropLotCount',count(*) filter (where input_crop_count=1 and includes_this_crop),
           'mixedCropLotCount',count(*) filter (where input_crop_count>1 and includes_this_crop),
           'lots',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'readyLotId',id,'preparationBatchId',preparation_batch_id,'inventoryKind',inventory_kind,
             'quantity',quantity,'unit',unit,'quantityExactness',quantity_exactness,'readyDate',ready_date,
             'retailUnitValue',retail_unit_value,'retailCurrency',retail_currency,'cropProfileId',crop_profile_id,
             'productLabel',product_label,'lineageClass',case when input_crop_count=1 and includes_this_crop then 'direct_single_crop' when input_crop_count>1 and includes_this_crop then 'mixed_crops_unallocated' else 'lineage_conflict' end,
             'inputCropCount',input_crop_count
           )) order by ready_date,created_at,id),'[]'::jsonb))
  into v_ready_count,v_direct_ready_count,v_mixed_ready_count,v_ready from ready_lineage;

  with relevant_preparations as (
    select distinct pi.preparation_batch_id from atlas.flower_preparation_inputs pi
    join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id where o.crop_cycle_id=v_cycle.id
  ), ready_lineage as (
    select r.id as ready_lot_id,count(distinct all_o.crop_cycle_id) filter (where all_o.crop_cycle_id is not null) as input_crop_count,
           bool_or(all_o.crop_cycle_id=v_cycle.id) as includes_this_crop
    from relevant_preparations rp join atlas.flower_ready_inventory_lots r on r.preparation_batch_id=rp.preparation_batch_id
    left join atlas.flower_preparation_inputs all_pi on all_pi.preparation_batch_id=r.preparation_batch_id
    left join atlas.flower_harvest_bucket_observations all_o on all_o.id=all_pi.harvest_observation_id group by r.id
  ), sale_rows as (
    select s.id as sale_order_id,sl.id as sale_line_id,sl.ready_lot_id,sl.quantity,sl.unit,sl.unit_price,
           coalesce(sl.line_total,sl.quantity*sl.unit_price) as line_total,s.sale_date,s.customer_label,s.sales_channel,
           s.fulfillment_due_date,s.currency,rl.input_crop_count,
           case when rl.input_crop_count=1 and rl.includes_this_crop then 'direct_single_crop' else 'mixed_crops_unallocated' end as lineage_class,
           exists(select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=s.id) as fulfilled,
           exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id) as cancelled
    from ready_lineage rl join atlas.flower_sale_order_lines sl on sl.ready_lot_id=rl.ready_lot_id
    join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  )
  select count(distinct sale_order_id) filter (where not cancelled)::integer,
         count(distinct sale_order_id) filter (where not cancelled and fulfilled)::integer,
         jsonb_build_object('activeSaleOrderCount',count(distinct sale_order_id) filter (where not cancelled),
           'fulfilledSaleOrderCount',count(distinct sale_order_id) filter (where not cancelled and fulfilled),
           'directCommittedRevenue',coalesce(sum(line_total) filter (where not cancelled and lineage_class='direct_single_crop'),0),
           'directRealizedRevenue',coalesce(sum(line_total) filter (where not cancelled and fulfilled and lineage_class='direct_single_crop'),0),
           'mixedLineageRevenueAttributionWithheld',coalesce(sum(line_total) filter (where not cancelled and lineage_class='mixed_crops_unallocated'),0),
           'currencySet',coalesce(jsonb_agg(distinct currency) filter (where not cancelled),'[]'::jsonb),
           'lines',coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
             'saleOrderId',sale_order_id,'saleLineId',sale_line_id,'readyLotId',ready_lot_id,'quantity',quantity,
             'unit',unit,'unitPrice',unit_price,'lineTotal',line_total,'saleDate',sale_date,'customerLabel',customer_label,
             'salesChannel',sales_channel,'fulfillmentDueDate',fulfillment_due_date,'fulfilled',fulfilled,'cancelled',cancelled,
             'lineageClass',lineage_class,'revenueAttributedToThisCrop',case when lineage_class='direct_single_crop' then line_total else null end
           )) order by sale_date,sale_order_id,sale_line_id),'[]'::jsonb))
  into v_sale_count,v_fulfilled_sale_count,v_sales from sale_rows;

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
    'subject',jsonb_strip_nulls(jsonb_build_object('cropCycleId',v_cycle.id,'farmId',v_cycle.farm_id,'cropCycleKey',v_cycle.crop_cycle_key,
      'cropLabel',v_cycle.crop_label,'variety',v_cycle.variety,'cropProfileId',v_cycle.crop_profile_id,'cycleState',v_cycle.cycle_state,'lifecycleStatus',v_cycle.lifecycle_status)),
    'currentRequirement',jsonb_build_object('snapshot',v_snapshot,'instance',v_requirement),'commercialTarget',v_commercial,
    'physicalHarvest',coalesce(v_physical,jsonb_build_object('observationCount',0,'observations','[]'::jsonb)),
    'preparation',coalesce(v_preparation,jsonb_build_object('preparationBatchCount',0,'batches','[]'::jsonb)),
    'readyInventory',coalesce(v_ready,jsonb_build_object('readyLotCount',0,'directSingleCropLotCount',0,'mixedCropLotCount',0,'lots','[]'::jsonb)),
    'commercialRealization',coalesce(v_sales,jsonb_build_object('activeSaleOrderCount',0,'fulfilledSaleOrderCount',0,'directCommittedRevenue',0,'directRealizedRevenue',0,'mixedLineageRevenueAttributionWithheld',0,'lines','[]'::jsonb)),
    'summary',jsonb_build_object('realizationClass',v_realization_class,'physicalObservationCount',v_obs_count,'preparationBatchCount',v_prep_count,
      'readyLotCount',v_ready_count,'directSingleCropReadyLotCount',v_direct_ready_count,'mixedCropReadyLotCount',v_mixed_ready_count,
      'activeSaleOrderCount',v_sale_count,'fulfilledSaleOrderCount',v_fulfilled_sale_count),
    'truthBoundary',jsonb_build_object('harvestRequirementIsNotPhysicalHarvest',true,'commercialTargetDoesNotEstablishHarvestRequirement',true,
      'physicalHarvestDoesNotCreateReadyInventory',true,'readyInventoryDoesNotMeanSold',true,'saleCommitmentDoesNotMeanFulfilled',true,
      'fulfillmentIsRequiredForRealizedRevenue',true,'mixedPreparationDoesNotAuthorizePerCropRevenueAllocation',true,
      'exactHalfBucketHarvestQuantityPreserved',true,'derivedReadOnlyContract',true,'existingDomainLedgersRemainAuthority',true)
  );
end;
$$;

create or replace function atlas.harvest_inventory_reality_expression_v1(p_ready_lot_id uuid)
returns jsonb
language plpgsql
stable
set search_path to 'pg_catalog','atlas'
as $$
declare
  v_ready atlas.flower_ready_inventory_lots%rowtype;
  v_prep atlas.flower_preparation_batches%rowtype;
  v_harvest atlas.flower_harvest_batches%rowtype;
  v_position record;
  v_state record;
  v_inputs jsonb := '[]'::jsonb;
  v_demand_claims jsonb := '[]'::jsonb;
  v_sale_claims jsonb := '[]'::jsonb;
  v_prospect_claims jsonb := '[]'::jsonb;
  v_fulfillment jsonb := '[]'::jsonb;
  v_dispositions jsonb := '[]'::jsonb;
  v_balance jsonb := null;
  v_input_count integer := 0;
  v_field_ready_count integer := 0;
  v_current_physical numeric := 0;
  v_sold_committed numeric := 0;
  v_current_claimed numeric := 0;
  v_custody_accounted numeric := 0;
  v_custody_reconciles boolean := false;
  v_lifecycle_state text;
  v_availability_state text;
  v_issues jsonb := '[]'::jsonb;
begin
  if p_ready_lot_id is null then raise exception 'A Ready inventory lot is required.' using errcode='22023'; end if;
  select * into v_ready from atlas.flower_ready_inventory_lots where id=p_ready_lot_id;
  if v_ready.id is null then raise exception 'Ready inventory lot was not found.' using errcode='P0002'; end if;
  select * into v_position from atlas.flower_ready_inventory_position_v1 where id=v_ready.id;
  select * into v_state from atlas.flower_ready_inventory_state_v1 where ready_lot_id=v_ready.id;
  select * into v_prep from atlas.flower_preparation_batches where id=v_ready.preparation_batch_id;
  if v_prep.id is not null then select * into v_harvest from atlas.flower_harvest_batches where id=v_prep.harvest_batch_id; end if;

  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'preparationInputId',pi.id,'harvestObservationId',o.id,'cropCycleId',o.crop_cycle_id,'cropLabel',cc.crop_label,
      'variety',cc.variety,'harvestTaskId',o.task_id,'harvestObservedDate',o.observed_date,
      'harvestQuantityFloor',o.bucket_equivalent_floor,'harvestBucketHalves',o.bucket_halves,'harvestUnit','bucket_equivalent',
      'harvestQuantityExactness',case when o.bucket_halves is not null then 'exact' when o.bucket_band='more_than_one' then 'lower_bound' else 'band_floor' end,
      'moreAvailable',o.more_available,'fieldReadinessAtRead',case when ha.crop_cycle_id is null then null else jsonb_build_object(
        'status',ha.status,'estimatedQuantity',ha.estimated_quantity,'unit',ha.unit,'observedDate',ha.observed_date,'sourceEventId',ha.source_event_id,'updatedAt',ha.updated_at) end,
      'sourceCycleCurrentState',cc.cycle_state,'sourceCycleCurrentLifecycleStatus',cc.lifecycle_status
    )) order by o.observed_date,o.id),'[]'::jsonb),count(*)::integer,
    count(*) filter (where ha.status='harvestable')::integer
  into v_inputs,v_input_count,v_field_ready_count
  from atlas.flower_preparation_inputs pi
  join atlas.flower_harvest_bucket_observations o on o.id=pi.harvest_observation_id
  join atlas.crop_cycles cc on cc.id=o.crop_cycle_id
  left join atlas.crop_harvest_availability ha on ha.crop_cycle_id=o.crop_cycle_id
  where pi.preparation_batch_id=v_ready.preparation_batch_id;

  select coalesce(jsonb_agg(jsonb_build_object('claimType','customer_or_event_demand','claimSource','flower_demand_allocation',
      'allocationId',a.id,'demandOrderId',d.id,'demandLineId',dl.id,'claimSubject',v_ready.id,'claimedQuantity',a.quantity,
      'unit',dl.unit,'intendedDestination',coalesce(d.customer_label,d.sales_channel),'requiredBy',d.requested_for_date,
      'claimStrength',d.demand_strength,'displacementAuthority',case when d.demand_strength='committed' then 'management_or_explicit_cancellation' else 'Farm Operations' end,
      'protectionReason',case when d.demand_strength='committed' then 'committed customer or event demand' else 'requested demand' end,
      'status','active_reserved','salesChannel',d.sales_channel,'sourceEvidence',jsonb_build_object('demandOrderId',d.id,'demandLineId',dl.id,'allocationId',a.id))
      order by d.requested_for_date,d.id,a.id),'[]'::jsonb)
  into v_demand_claims
  from atlas.flower_demand_allocations a join atlas.flower_demand_order_lines dl on dl.id=a.demand_line_id
  join atlas.flower_demand_orders d on d.id=dl.demand_order_id
  where a.ready_lot_id=v_ready.id and not exists(select 1 from atlas.flower_demand_allocation_release_events r where r.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_sale_line_links sl where sl.allocation_id=a.id)
    and not exists(select 1 from atlas.flower_demand_order_cancellation_events dc where dc.demand_order_id=d.id);

  select coalesce(jsonb_agg(jsonb_build_object('claimType',case when s.event_key is null then 'customer_sale_commitment' else 'event_sale_commitment' end,
      'claimSource','flower_sale_order_line','saleOrderId',s.id,'saleLineId',sl.id,'claimSubject',v_ready.id,'claimedQuantity',sl.quantity,
      'unit',sl.unit,'intendedDestination',coalesce(s.customer_label,s.event_key,s.sales_channel),'requiredBy',s.fulfillment_due_date,
      'claimStrength','committed','displacementAuthority','management_or_explicit_cancellation','protectionReason','recorded sale commitment awaiting fulfillment',
      'status','sold_committed','salesChannel',s.sales_channel,'eventKey',s.event_key,'sourceEvidence',jsonb_build_object('saleOrderId',s.id,'saleLineId',sl.id))
      order by s.fulfillment_due_date nulls first,s.id,sl.id),'[]'::jsonb)
  into v_sale_claims
  from atlas.flower_sale_order_lines sl join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  where sl.ready_lot_id=v_ready.id and not exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id)
    and not exists(select 1 from atlas.flower_fulfillment_events f where f.sale_order_id=s.id);

  select coalesce(jsonb_agg(jsonb_build_object('claimType','prospect_route_custody','claimSource','flower_prospect_route_line',
      'prospectRouteId',r.id,'prospectRouteLineId',l.id,'claimSubject',v_ready.id,'claimedQuantity',greatest(l.quantity-coalesce(rel.released_quantity,0),0),
      'unit',v_ready.unit,'intendedDestination',coalesce(l.destination_label,r.route_label),'requiredBy',r.route_date,'claimStrength','planned',
      'displacementAuthority','Farm Operations','protectionReason','inventory physically routed for prospecting','status','on_prospect_route',
      'sourceEvidence',jsonb_build_object('prospectRouteId',r.id,'prospectRouteLineId',l.id)) order by r.route_date,r.id,l.id)
      filter(where greatest(l.quantity-coalesce(rel.released_quantity,0),0)>0),'[]'::jsonb)
  into v_prospect_claims
  from atlas.flower_prospect_route_lines l join atlas.flower_prospect_routes r on r.id=l.prospect_route_id
  left join lateral(select sum(e.quantity) as released_quantity from atlas.flower_prospect_route_release_events e where e.prospect_route_line_id=l.id) rel on true
  where l.ready_lot_id=v_ready.id;

  select coalesce(jsonb_agg(jsonb_build_object('fulfillmentEventId',f.id,'saleOrderId',s.id,'fulfilledQuantity',sl.quantity,'unit',sl.unit,
      'customerOrEvent',coalesce(s.customer_label,s.event_key,s.sales_channel),'fulfilledAt',f.fulfilled_at,'fulfillmentMethod',f.fulfillment_method,
      'sourceEvidence',jsonb_build_object('saleOrderId',s.id,'saleLineId',sl.id,'fulfillmentEventId',f.id)) order by f.fulfilled_at,f.id),'[]'::jsonb)
  into v_fulfillment from atlas.flower_sale_order_lines sl join atlas.flower_sale_orders s on s.id=sl.sale_order_id
  join atlas.flower_fulfillment_events f on f.sale_order_id=s.id where sl.ready_lot_id=v_ready.id
    and not exists(select 1 from atlas.flower_sale_order_cancellation_events c where c.sale_order_id=s.id);

  select coalesce(jsonb_agg(jsonb_build_object('dispositionEventId',e.id,'kind',e.disposition_kind,'quantity',e.quantity,'unit',e.unit,
      'note',e.note,'createdAt',e.created_at,'sourceEvidence',jsonb_build_object('dispositionEventId',e.id)) order by e.created_at,e.id),'[]'::jsonb)
  into v_dispositions from atlas.flower_ready_inventory_disposition_events e where e.ready_lot_id=v_ready.id;

  select to_jsonb(b) into v_balance from atlas.flower_supply_demand_balance_v1 b
  where b.farm_id=v_ready.farm_id and b.inventory_kind=v_ready.inventory_kind and b.unit=v_ready.unit
    and b.crop_profile_id is not distinct from v_ready.crop_profile_id limit 1;

  v_sold_committed:=greatest(coalesce(v_position.active_claimed_quantity,0)-coalesce(v_position.fulfilled_quantity,0),0);
  v_current_physical:=greatest(coalesce(v_position.birth_quantity,0)-coalesce(v_position.fulfilled_quantity,0)-coalesce(v_position.disposed_quantity,0),0);
  v_current_claimed:=coalesce(v_position.demand_reserved_quantity,0)+v_sold_committed+coalesce(v_position.on_prospect_route_quantity,0);
  v_custody_accounted:=coalesce(v_position.available_quantity,0)+v_current_claimed;
  v_custody_reconciles:=abs(v_current_physical-v_custody_accounted)<0.0001 and coalesce(v_state.state_reconciles,false);

  v_lifecycle_state:=case when v_input_count=0 then 'ready_without_harvest_input_gap' when v_prep.id is null or v_harvest.id is null then 'ready_lineage_gap'
    when v_prep.result_kind<>'ready' then 'ready_preparation_conflict' when v_field_ready_count>0 then 'field_ready_to_harvested_to_processing_to_ready_supported'
    else 'harvested_to_processing_to_ready_supported_field_readiness_not_currently_proven' end;
  v_availability_state:=case when not v_custody_reconciles then 'custody_reconciliation_required'
    when coalesce(v_position.available_quantity,0)<=0 and v_current_physical<=0 then 'no_physical_inventory_remaining'
    when coalesce(v_position.available_quantity,0)<=0 and v_current_claimed>0 then 'fully_claimed'
    when coalesce(v_position.available_quantity,0)>0 and v_current_claimed>0 then 'partially_available_after_claims'
    when coalesce(v_position.available_quantity,0)>0 then 'available_unclaimed' else 'not_available' end;

  if not v_custody_reconciles then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('key','inventory_custody_does_not_reconcile','severity','attention','physicalQuantity',v_current_physical,'accountedPhysicalQuantity',v_custody_accounted)); end if;
  if v_input_count=0 then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('key','ready_inventory_missing_harvest_lineage','severity','attention')); end if;
  if v_ready.quantity_exactness<>'exact' then v_issues:=v_issues||jsonb_build_array(jsonb_build_object('key','inventory_quantity_is_lower_bound','severity','context','quantityExactness',v_ready.quantity_exactness)); end if;

  return jsonb_build_object(
    'contractVersion','harvest_inventory_reality_expression_v1',
    'subject',jsonb_strip_nulls(jsonb_build_object('subjectType','flower_ready_inventory_lot','id',v_ready.id,'farmId',v_ready.farm_id,'inventoryKind',v_ready.inventory_kind,'cropProfileId',v_ready.crop_profile_id,'productLabel',v_ready.product_label,'unit',v_ready.unit,'quantityExactness',v_ready.quantity_exactness,'readyDate',v_ready.ready_date)),
    'lifecycle',jsonb_build_object('state',v_lifecycle_state,
      'fieldReadyEvidence',jsonb_build_object('supportedInputCount',v_field_ready_count,'principle','Field readiness is reported only when the linked crop harvest-availability rail currently carries an explicit harvestable state; Harvest itself is not used to back-infer prior readiness.'),
      'harvested',jsonb_strip_nulls(jsonb_build_object('harvestBatchId',v_harvest.id,'harvestDate',v_harvest.harvest_date,'batchKey',v_harvest.batch_key,'inputs',v_inputs)),
      'processing',jsonb_strip_nulls(jsonb_build_object('preparationBatchId',v_prep.id,'preparedDate',v_prep.prepared_date,'resultKind',v_prep.result_kind,'sourceHarvestBatchId',v_prep.harvest_batch_id)),
      'ready',jsonb_build_object('readyLotId',v_ready.id,'readyDate',v_ready.ready_date,'birthQuantity',v_position.birth_quantity,'unit',v_ready.unit)),
    'custody',jsonb_build_object('physicalQuantity',v_current_physical,'availableQuantity',v_position.available_quantity,'claimedQuantity',v_current_claimed,
      'demandReservedQuantity',v_position.demand_reserved_quantity,'soldCommittedQuantity',v_sold_committed,'onProspectRouteQuantity',v_position.on_prospect_route_quantity,
      'fulfilledQuantity',v_position.fulfilled_quantity,'disposedQuantity',v_position.disposed_quantity,'accountedPhysicalQuantity',v_custody_accounted,
      'reconciles',v_custody_reconciles,'availabilityState',v_availability_state,
      'principle','Physical existence is separate from availability. Current physical custody equals available plus outstanding demand, sale, and route claims; fulfilled and disposed quantities have left current physical custody.'),
    'claims',jsonb_build_object('demandReservations',v_demand_claims,'saleCommitments',v_sale_claims,'prospectRouteCustody',v_prospect_claims,'activeClaimedQuantity',v_current_claimed,
      'principle','Converted demand allocations are not double-counted after they become sale lines; fulfilled sale lines are no longer active claims.'),
    'movement',jsonb_build_object('fulfillment',v_fulfillment,'dispositions',v_dispositions,'principle','Fulfillment and disposition are custody exits, not reductions in the historical quantity that was originally prepared.'),
    'revenueDemand',jsonb_build_object('preparedRetailValue',v_position.prepared_retail_value,'recordedNoncancelledSaleRevenue',v_position.active_committed_product_revenue,
      'outstandingCommittedProductRevenue',greatest(coalesce(v_position.active_committed_product_revenue,0)-coalesce(v_position.realized_product_revenue,0),0),
      'realizedProductRevenue',v_position.realized_product_revenue,'supplyDemandBalance',v_balance,
      'principle','Revenue and demand are reconciled through native sale, demand, allocation, fulfillment, and Ready inventory rails. Outstanding committed revenue excludes fulfilled sale value; realized revenue is reported separately.'),
    'issues',v_issues,
    'truthBoundary',jsonb_build_object('readOnly',true,'physicalIsNotAvailable',true,'claimRequiresSourceAndDestination',true,'fulfilledIsNotCurrentClaim',true,
      'disposedIsNotPhysicalInventory',true,'harvestDoesNotBackInferReadiness',true,'exactHalfBucketHarvestQuantityPreserved',true,'domainNativeRailsPreserved',true,'noGenericClaimTableAdded',true)
  );
end;
$$;

-- Replace only the preparation-input insertion behavior so exact weekly quantities
-- are not mislabeled as lower bounds merely because the legacy band is more_than_one.
create or replace function atlas.record_flower_preparation_core_v1(
  p_task_id uuid,p_effective_membership_id uuid,p_effective_role text,p_outputs jsonb,p_no_saleable_output boolean,
  p_note text,p_idempotency_key text,p_operator_mode boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog','atlas','auth'
as $$
declare
  v_task atlas.tasks%rowtype; v_membership atlas.farm_memberships%rowtype; v_batch atlas.flower_harvest_batches%rowtype;
  v_existing atlas.flower_preparation_batches%rowtype; v_preparation atlas.flower_preparation_batches%rowtype;
  v_today date:=(now() at time zone 'America/Chicago')::date; v_key text:=nullif(btrim(coalesce(p_idempotency_key,'')),'');
  v_batch_id uuid; v_output jsonb; v_kind text; v_quantity numeric(10,2); v_lower_bound boolean; v_unit text; v_exactness text;
  v_crop_profile_id uuid; v_product_label text; v_output_index integer:=0; v_input_count integer:=0; v_ready jsonb:='[]'::jsonb;
  v_ready_row atlas.flower_ready_inventory_lots%rowtype; v_transition jsonb; v_remaining_observation_id uuid; v_next_task jsonb;
begin
  if v_key is null then raise exception 'Preparation idempotency key is required.' using errcode='22023'; end if;
  if p_outputs is null then p_outputs:='[]'::jsonb; end if;
  if jsonb_typeof(p_outputs)<>'array' then raise exception 'Ready outputs must be an array.' using errcode='22023'; end if;
  if coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)>0 then raise exception 'No-saleable-output cannot also create Ready inventory.' using errcode='22023'; end if;
  if not coalesce(p_no_saleable_output,false) and jsonb_array_length(p_outputs)=0 then raise exception 'Record at least one Ready output or mark that nothing saleable resulted.' using errcode='22023'; end if;
  select * into v_task from atlas.tasks where id=p_task_id for update;
  if v_task.id is null then raise exception 'Preparation task not found.' using errcode='P0002'; end if;
  select * into v_existing from atlas.flower_preparation_batches where farm_id=v_task.farm_id and idempotency_key=v_key;
  if v_existing.id is not null then
    select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'inventoryKind',r.inventory_kind,'cropProfileId',r.crop_profile_id,'productLabel',r.product_label,'quantity',r.quantity,'unit',r.unit,'quantityExactness',r.quantity_exactness,'readyDate',r.ready_date) order by r.created_at),'[]'::jsonb)
    into v_ready from atlas.flower_ready_inventory_lots r where r.preparation_batch_id=v_existing.id;
    return jsonb_build_object('preparationBatchId',v_existing.id,'taskId',v_existing.task_id,'resultKind',v_existing.result_kind,'readyLots',v_ready,'deduplicated',true);
  end if;
  if v_task.status not in ('open','blocked') or v_task.task_type<>'flower_preparation' then raise exception 'Task is not an open flower preparation.' using errcode='22023'; end if;
  if p_effective_role not in ('owner','manager','farm_hand') then raise exception 'Selected account cannot record flower preparation.' using errcode='42501'; end if;
  select * into v_membership from atlas.farm_memberships where id=p_effective_membership_id;
  if v_membership.id is null or not v_membership.active or v_membership.farm_id is distinct from v_task.farm_id then raise exception 'Active farm membership required.' using errcode='42501'; end if;
  if p_effective_role='farm_hand' and (v_task.visibility_scope<>'assigned_worker' or v_task.assigned_membership_id is distinct from p_effective_membership_id) then raise exception 'Preparation task is not assigned to this worker.' using errcode='42501'; end if;
  begin v_batch_id:=nullif(v_task.metadata->>'flower_harvest_batch_id','')::uuid; exception when invalid_text_representation then v_batch_id:=null; end;
  if v_batch_id is null then raise exception 'Preparation task has no harvest batch.' using errcode='22023'; end if;
  select * into v_batch from atlas.flower_harvest_batches where id=v_batch_id;
  if v_batch.id is null or v_batch.farm_id is distinct from v_task.farm_id then raise exception 'Preparation harvest batch is outside the task farm.' using errcode='22023'; end if;
  perform 1 from atlas.flower_harvest_bucket_observations h where h.batch_id=v_batch.id
    and not exists(select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id) for update;
  select count(*) into v_input_count from atlas.flower_harvest_bucket_observations h where h.batch_id=v_batch.id
    and not exists(select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id);
  if v_input_count=0 then raise exception 'There is no unprepared harvest output in this batch.' using errcode='22023'; end if;
  for v_output in select value from jsonb_array_elements(p_outputs) loop
    if jsonb_typeof(v_output)<>'object' then raise exception 'Each Ready output must be an object.' using errcode='22023'; end if;
    v_kind:=lower(btrim(coalesce(v_output->>'kind',v_output->>'inventoryKind','')));
    if v_kind not in ('conditioned_bucket','counted_stems','posy','bouquet','lobby_arrangement') then raise exception 'Choose a supported Ready inventory kind.' using errcode='22023'; end if;
    begin v_quantity:=(v_output->>'quantity')::numeric; exception when others then raise exception 'Ready quantity must be numeric.' using errcode='22023'; end;
    if v_quantity is null or v_quantity<=0 or v_quantity>10000 then raise exception 'Ready quantity must be greater than zero.' using errcode='22023'; end if;
    begin v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false); exception when others then raise exception 'Ready lowerBound must be boolean.' using errcode='22023'; end;
    begin v_crop_profile_id:=nullif(v_output->>'cropProfileId','')::uuid; exception when others then raise exception 'Ready cropProfileId must be a valid crop profile UUID.' using errcode='22023'; end;
    v_product_label:=nullif(btrim(coalesce(v_output->>'productLabel','')),'');
    if v_kind='conditioned_bucket' then if mod(v_quantity*4,1)<>0 then raise exception 'Conditioned bucket quantity must use quarter-bucket increments.' using errcode='22023'; end if;
    else
      if mod(v_quantity,1)<>0 then raise exception 'Counted Ready units must be whole numbers.' using errcode='22023'; end if;
      if v_lower_bound then raise exception 'Only conditioned bucket output may remain a lower bound.' using errcode='22023'; end if;
    end if;
    if v_kind='counted_stems' and v_crop_profile_id is null then raise exception 'Counted-stem Ready inventory requires crop identity.' using errcode='22023'; end if;
    if v_crop_profile_id is not null and not exists(
      select 1 from atlas.flower_harvest_bucket_observations h join atlas.crop_cycles c on c.id=h.crop_cycle_id
      where h.batch_id=v_batch.id and c.crop_profile_id=v_crop_profile_id
        and not exists(select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id)
    ) then raise exception 'Ready crop identity is not present in the unprepared harvest input.' using errcode='22023'; end if;
  end loop;
  insert into atlas.flower_preparation_batches(farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,result_kind,note,idempotency_key,created_by_user_id,metadata)
  values(v_task.farm_id,v_batch.id,v_task.id,v_today,p_effective_membership_id,case when coalesce(p_no_saleable_output,false) then 'no_saleable_output' else 'ready' end,
    nullif(btrim(coalesce(p_note,'')),''),v_key,auth.uid(),jsonb_build_object('operatorMode',p_operator_mode,'effectiveMembershipId',p_effective_membership_id,'inputCount',v_input_count,'truthBoundary','completed_preparation'))
  returning * into v_preparation;
  insert into atlas.flower_preparation_inputs(farm_id,preparation_batch_id,harvest_observation_id,source_bucket_band,source_bucket_equivalent_floor,source_lower_bound)
  select h.farm_id,v_preparation.id,h.id,h.bucket_band,h.bucket_equivalent_floor,(h.bucket_band='more_than_one' and h.bucket_halves is null)
  from atlas.flower_harvest_bucket_observations h where h.batch_id=v_batch.id
    and not exists(select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id) order by h.created_at;
  for v_output in select value from jsonb_array_elements(p_outputs) loop
    v_output_index:=v_output_index+1; v_kind:=lower(btrim(coalesce(v_output->>'kind',v_output->>'inventoryKind')));
    v_quantity:=(v_output->>'quantity')::numeric; v_lower_bound:=coalesce((v_output->>'lowerBound')::boolean,false);
    v_crop_profile_id:=nullif(v_output->>'cropProfileId','')::uuid; v_product_label:=nullif(btrim(coalesce(v_output->>'productLabel','')),'');
    v_unit:=case v_kind when 'conditioned_bucket' then 'bucket_equivalent' when 'counted_stems' then 'stem' when 'posy' then 'posy' when 'bouquet' then 'bouquet' when 'lobby_arrangement' then 'arrangement' end;
    v_exactness:=case when v_lower_bound then 'lower_bound' else 'exact' end;
    insert into atlas.flower_ready_inventory_lots(farm_id,preparation_batch_id,inventory_kind,crop_profile_id,product_label,quantity,unit,quantity_exactness,ready_date,idempotency_key,created_by_user_id,metadata)
    values(v_task.farm_id,v_preparation.id,v_kind,v_crop_profile_id,v_product_label,v_quantity,v_unit,v_exactness,v_today,v_key||':ready:'||v_output_index::text,auth.uid(),
      jsonb_build_object('sourceHarvestBatchId',v_batch.id,'sourcePreparationBatchId',v_preparation.id,'cropProfileId',v_crop_profile_id,'productLabel',v_product_label,'truthBoundary','finished_saleable_inventory'))
    returning * into v_ready_row;
    v_ready:=v_ready||jsonb_build_array(jsonb_build_object('id',v_ready_row.id,'inventoryKind',v_ready_row.inventory_kind,'cropProfileId',v_ready_row.crop_profile_id,'productLabel',v_ready_row.product_label,'quantity',v_ready_row.quantity,'unit',v_ready_row.unit,'quantityExactness',v_ready_row.quantity_exactness,'readyDate',v_ready_row.ready_date));
  end loop;
  v_transition:=atlas.record_task_transition_v1_internal(v_task.id,'done','flower-preparation:'||v_preparation.id::text,null,p_note,null,'prepare','flower_preparation',
    jsonb_build_object('flower_harvest_batch_id',v_batch.id,'flower_preparation_batch_id',v_preparation.id,'result_kind',v_preparation.result_kind,'input_count',v_input_count,'ready_lot_count',jsonb_array_length(v_ready)),null);
  select h.id into v_remaining_observation_id from atlas.flower_harvest_bucket_observations h where h.batch_id=v_batch.id
    and not exists(select 1 from atlas.flower_preparation_inputs i where i.harvest_observation_id=h.id) order by h.created_at limit 1;
  if v_remaining_observation_id is not null then v_next_task:=atlas.ensure_flower_preparation_task_v1(v_batch.id,v_remaining_observation_id,v_batch.recorded_by_membership_id,v_today); end if;
  return jsonb_build_object('preparationBatchId',v_preparation.id,'harvestBatchId',v_batch.id,'taskId',v_task.id,'resultKind',v_preparation.result_kind,
    'inputCount',v_input_count,'readyLots',v_ready,'nextPreparation',v_next_task,'transition',v_transition,'deduplicated',false);
end;
$$;