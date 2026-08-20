begin;

do $proof$
declare
  v_farm_id uuid;
  v_member_id uuid;
  v_task_id uuid;
  v_object_id uuid;
  v_cycle_id uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_obs_id uuid := gen_random_uuid();
  v_prep_id uuid := gen_random_uuid();
  v_ready_id uuid := gen_random_uuid();
  v_sale_id uuid := gen_random_uuid();
  v_state jsonb;
  v_label text := 'P10 Single Crop ' || substr(gen_random_uuid()::text,1,8);
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_member_id from atlas.farm_memberships where farm_id=v_farm_id and active and role='owner' limit 1;
  select id into v_task_id from atlas.tasks where farm_id=v_farm_id order by created_at desc limit 1;
  select id into v_object_id from atlas.growing_objects where farm_id=v_farm_id order by created_at limit 1;
  if v_farm_id is null or v_member_id is null or v_task_id is null or v_object_id is null then
    raise exception 'P10 fixture prerequisites missing.';
  end if;

  insert into atlas.crop_cycles(id,farm_id,object_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,metadata)
  values(v_cycle_id,v_farm_id,v_object_id,'p10-single-crop-'||v_cycle_id::text,v_label,v_label,'harvesting','active',jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task_id,v_cycle_id,'affects','confirmed','test',jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_harvest_batches(id,farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata)
  values(v_batch_id,v_farm_id,current_date,v_member_id,'p10-single-'||v_batch_id::text,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_harvest_bucket_observations(id,farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,bucket_band,bucket_equivalent_floor,more_available,idempotency_key,metadata)
  values(v_obs_id,v_farm_id,v_batch_id,v_cycle_id,v_task_id,v_member_id,current_date,'one',1,false,'p10-obs-'||v_obs_id::text,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_preparation_batches(id,farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,result_kind,idempotency_key,metadata)
  values(v_prep_id,v_farm_id,v_batch_id,v_task_id,current_date,v_member_id,'ready','p10-prep-'||v_prep_id::text,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_preparation_inputs(farm_id,preparation_batch_id,harvest_observation_id,source_bucket_band,source_bucket_equivalent_floor,source_lower_bound)
  values(v_farm_id,v_prep_id,v_obs_id,'one',1,false);

  insert into atlas.flower_ready_inventory_lots(id,farm_id,preparation_batch_id,inventory_kind,quantity,unit,quantity_exactness,ready_date,idempotency_key,metadata)
  values(v_ready_id,v_farm_id,v_prep_id,'conditioned_bucket',1,'bucket_equivalent','exact',current_date,'p10-ready-'||v_ready_id::text,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_sale_orders(id,farm_id,customer_label,sales_channel,sale_date,fulfillment_mode,subtotal_amount,tax_amount,tip_amount,total_amount,currency,idempotency_key,recorded_by_membership_id,metadata)
  values(v_sale_id,v_farm_id,'P10 rollback buyer','farm_pickup',current_date,'immediate_handoff',25,0,0,25,'USD','p10-sale-'||v_sale_id::text,v_member_id,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_sale_order_lines(farm_id,sale_order_id,ready_lot_id,inventory_kind,quantity,unit,unit_price,metadata)
  values(v_farm_id,v_sale_id,v_ready_id,'conditioned_bucket',1,'bucket_equivalent',25,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  insert into atlas.flower_fulfillment_events(farm_id,sale_order_id,fulfilled_at,fulfillment_method,recorded_by_membership_id,idempotency_key,metadata)
  values(v_farm_id,v_sale_id,now(),'immediate_handoff',v_member_id,'p10-fulfill-'||v_sale_id::text,jsonb_build_object('test_fixture','p10_single_crop_full_chain'));

  v_state:=atlas.crop_harvest_realization_state_v1(v_cycle_id);

  if v_state#>>'{summary,realizationClass}' <> 'fulfilled_commercial_result_exists' then
    raise exception 'Expected fulfilled commercial result. state=%',v_state;
  end if;

  if (v_state#>>'{summary,physicalObservationCount}')::int <> 1
     or (v_state#>>'{summary,preparationBatchCount}')::int <> 1
     or (v_state#>>'{summary,readyLotCount}')::int <> 1
     or (v_state#>>'{summary,directSingleCropReadyLotCount}')::int <> 1
     or (v_state#>>'{summary,mixedCropReadyLotCount}')::int <> 0
     or (v_state#>>'{summary,activeSaleOrderCount}')::int <> 1
     or (v_state#>>'{summary,fulfilledSaleOrderCount}')::int <> 1 then
    raise exception 'Single-crop chain counts wrong. state=%',v_state;
  end if;

  if (v_state#>>'{commercialRealization,directCommittedRevenue}')::numeric <> 25
     or (v_state#>>'{commercialRealization,directRealizedRevenue}')::numeric <> 25
     or (v_state#>>'{commercialRealization,mixedLineageRevenueAttributionWithheld}')::numeric <> 0 then
    raise exception 'Revenue realization wrong. state=%',v_state;
  end if;
end;
$proof$;

rollback;
