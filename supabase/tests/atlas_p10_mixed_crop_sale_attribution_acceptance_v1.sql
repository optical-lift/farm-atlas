begin;

do $proof$
declare
  v_farm_id uuid;
  v_member_id uuid;
  v_task_id uuid;
  v_object_id uuid;
  v_cycle_a uuid := gen_random_uuid();
  v_cycle_b uuid := gen_random_uuid();
  v_batch_id uuid := gen_random_uuid();
  v_obs_a uuid := gen_random_uuid();
  v_obs_b uuid := gen_random_uuid();
  v_prep_id uuid := gen_random_uuid();
  v_ready_id uuid := gen_random_uuid();
  v_sale_id uuid := gen_random_uuid();
  v_state_a jsonb;
  v_state_b jsonb;
  v_target_a jsonb;
  v_target_b jsonb;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_member_id from atlas.farm_memberships where farm_id=v_farm_id and active and role='owner' limit 1;
  select id into v_task_id from atlas.tasks where farm_id=v_farm_id order by created_at desc limit 1;
  select id into v_object_id from atlas.growing_objects where farm_id=v_farm_id order by created_at limit 1;
  if v_farm_id is null or v_member_id is null or v_task_id is null or v_object_id is null then
    raise exception 'P10 mixed-crop fixture prerequisites missing.';
  end if;

  insert into atlas.crop_cycles(id,farm_id,object_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,harvest_started_date,metadata)
  values
    (v_cycle_a,v_farm_id,v_object_id,'p10-mixed-a-'||v_cycle_a::text,'P10 Mixed Crop A '||substr(v_cycle_a::text,1,8),'P10 Mixed A','harvesting','active',current_date,jsonb_build_object('test_fixture','p10_mixed_crop_sale')),
    (v_cycle_b,v_farm_id,v_object_id,'p10-mixed-b-'||v_cycle_b::text,'P10 Mixed Crop B '||substr(v_cycle_b::text,1,8),'P10 Mixed B','harvesting','active',current_date,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values
    (v_task_id,v_cycle_a,'affects','confirmed','test',jsonb_build_object('test_fixture','p10_mixed_crop_sale')),
    (v_task_id,v_cycle_b,'affects','confirmed','test',jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_harvest_batches(id,farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata)
  values(v_batch_id,v_farm_id,current_date,v_member_id,'p10-mixed-'||v_batch_id::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_harvest_bucket_observations(id,farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,bucket_band,bucket_equivalent_floor,more_available,idempotency_key,metadata)
  values
    (v_obs_a,v_farm_id,v_batch_id,v_cycle_a,v_task_id,v_member_id,current_date,'half',0.5,false,'p10-mixed-obs-a-'||v_obs_a::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale')),
    (v_obs_b,v_farm_id,v_batch_id,v_cycle_b,v_task_id,v_member_id,current_date,'half',0.5,false,'p10-mixed-obs-b-'||v_obs_b::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_preparation_batches(id,farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,result_kind,idempotency_key,metadata)
  values(v_prep_id,v_farm_id,v_batch_id,v_task_id,current_date,v_member_id,'ready','p10-mixed-prep-'||v_prep_id::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_preparation_inputs(farm_id,preparation_batch_id,harvest_observation_id,source_bucket_band,source_bucket_equivalent_floor,source_lower_bound)
  values
    (v_farm_id,v_prep_id,v_obs_a,'half',0.5,false),
    (v_farm_id,v_prep_id,v_obs_b,'half',0.5,false);

  insert into atlas.flower_ready_inventory_lots(id,farm_id,preparation_batch_id,inventory_kind,quantity,unit,quantity_exactness,ready_date,idempotency_key,metadata)
  values(v_ready_id,v_farm_id,v_prep_id,'conditioned_bucket',1,'bucket_equivalent','exact',current_date,'p10-mixed-ready-'||v_ready_id::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_sale_orders(id,farm_id,customer_label,sales_channel,sale_date,fulfillment_mode,subtotal_amount,tax_amount,tip_amount,total_amount,currency,idempotency_key,recorded_by_membership_id,metadata)
  values(v_sale_id,v_farm_id,'P10 mixed rollback buyer','farm_pickup',current_date,'immediate_handoff',40,0,0,40,'USD','p10-mixed-sale-'||v_sale_id::text,v_member_id,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_sale_order_lines(farm_id,sale_order_id,ready_lot_id,inventory_kind,quantity,unit,unit_price,metadata)
  values(v_farm_id,v_sale_id,v_ready_id,'conditioned_bucket',1,'bucket_equivalent',40,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  insert into atlas.flower_fulfillment_events(farm_id,sale_order_id,fulfilled_at,fulfillment_method,recorded_by_membership_id,idempotency_key,metadata)
  values(v_farm_id,v_sale_id,now(),'immediate_handoff',v_member_id,'p10-mixed-fulfill-'||v_sale_id::text,jsonb_build_object('test_fixture','p10_mixed_crop_sale'));

  v_target_a:=atlas.crop_harvest_commercial_target_state_v1(v_cycle_a);
  v_target_b:=atlas.crop_harvest_commercial_target_state_v1(v_cycle_b);
  v_state_a:=atlas.crop_harvest_realization_state_v1(v_cycle_a);
  v_state_b:=atlas.crop_harvest_realization_state_v1(v_cycle_b);

  if v_target_a->>'state' <> 'target_established' or v_target_b->>'state' <> 'target_established' then
    raise exception 'Mixed sale did not establish commercial disposition for both crops. a=% b=%',v_target_a,v_target_b;
  end if;

  if not exists (
      select 1 from jsonb_array_elements(v_target_a->'targets') x
      where x->>'sourceKind'='downstream_sale_commitment'
        and x->>'lineageClass'='mixed_crops_disposition_proven_revenue_unallocated'
    )
     or not exists (
      select 1 from jsonb_array_elements(v_target_b->'targets') x
      where x->>'sourceKind'='downstream_sale_commitment'
        and x->>'lineageClass'='mixed_crops_disposition_proven_revenue_unallocated'
    ) then
    raise exception 'Mixed sale lineage was not preserved as disposition-proven/revenue-unallocated. a=% b=%',v_target_a,v_target_b;
  end if;

  if v_state_a#>>'{summary,realizationClass}' <> 'fulfilled_commercial_result_exists'
     or v_state_b#>>'{summary,realizationClass}' <> 'fulfilled_commercial_result_exists' then
    raise exception 'Fulfillment did not reach both crop realization histories. a=% b=%',v_state_a,v_state_b;
  end if;

  if (v_state_a#>>'{summary,directSingleCropReadyLotCount}')::int <> 0
     or (v_state_b#>>'{summary,directSingleCropReadyLotCount}')::int <> 0
     or (v_state_a#>>'{summary,mixedCropReadyLotCount}')::int <> 1
     or (v_state_b#>>'{summary,mixedCropReadyLotCount}')::int <> 1 then
    raise exception 'Mixed Ready lineage counts are wrong. a=% b=%',v_state_a,v_state_b;
  end if;

  if (v_state_a#>>'{commercialRealization,directCommittedRevenue}')::numeric <> 0
     or (v_state_b#>>'{commercialRealization,directCommittedRevenue}')::numeric <> 0
     or (v_state_a#>>'{commercialRealization,directRealizedRevenue}')::numeric <> 0
     or (v_state_b#>>'{commercialRealization,directRealizedRevenue}')::numeric <> 0
     or (v_state_a#>>'{commercialRealization,mixedLineageRevenueAttributionWithheld}')::numeric <> 40
     or (v_state_b#>>'{commercialRealization,mixedLineageRevenueAttributionWithheld}')::numeric <> 40 then
    raise exception 'Mixed-crop revenue was falsely attributed or not withheld. a=% b=%',v_state_a,v_state_b;
  end if;
end;
$proof$;

rollback;
