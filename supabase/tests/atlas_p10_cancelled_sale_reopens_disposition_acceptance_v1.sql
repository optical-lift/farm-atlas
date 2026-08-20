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
  v_target_before jsonb;
  v_target_after_sale jsonb;
  v_target_after_cancel jsonb;
  v_state_after_cancel jsonb;
  v_open_before integer;
  v_open_after_sale integer;
  v_open_after_cancel integer;
begin
  select id into v_farm_id from atlas.farms where stable_key='elm_farm';
  select id into v_member_id from atlas.farm_memberships where farm_id=v_farm_id and active and role='owner' limit 1;
  select id into v_task_id from atlas.tasks where farm_id=v_farm_id order by created_at desc limit 1;
  select id into v_object_id from atlas.growing_objects where farm_id=v_farm_id order by created_at limit 1;
  if v_farm_id is null or v_member_id is null or v_task_id is null or v_object_id is null then
    raise exception 'P10 cancellation fixture prerequisites missing.';
  end if;

  insert into atlas.crop_cycles(id,farm_id,object_id,crop_cycle_key,crop_label,variety,cycle_state,lifecycle_status,harvest_started_date,metadata)
  values(v_cycle_id,v_farm_id,v_object_id,'p10-cancel-'||v_cycle_id::text,'P10 Cancellation '||substr(v_cycle_id::text,1,8),'P10 Cancel','harvesting','active',current_date,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.task_crop_cycles(task_id,crop_cycle_id,role,confidence,source,metadata)
  values(v_task_id,v_cycle_id,'affects','confirmed','test',jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.flower_harvest_batches(id,farm_id,harvest_date,recorded_by_membership_id,batch_key,metadata)
  values(v_batch_id,v_farm_id,current_date,v_member_id,'p10-cancel-'||v_batch_id::text,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.flower_harvest_bucket_observations(id,farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,bucket_band,bucket_equivalent_floor,more_available,idempotency_key,metadata)
  values(v_obs_id,v_farm_id,v_batch_id,v_cycle_id,v_task_id,v_member_id,current_date,'one',1,false,'p10-cancel-obs-'||v_obs_id::text,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.flower_preparation_batches(id,farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,result_kind,idempotency_key,metadata)
  values(v_prep_id,v_farm_id,v_batch_id,v_task_id,current_date,v_member_id,'ready','p10-cancel-prep-'||v_prep_id::text,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.flower_preparation_inputs(farm_id,preparation_batch_id,harvest_observation_id,source_bucket_band,source_bucket_equivalent_floor,source_lower_bound)
  values(v_farm_id,v_prep_id,v_obs_id,'one',1,false);

  insert into atlas.flower_ready_inventory_lots(id,farm_id,preparation_batch_id,inventory_kind,quantity,unit,quantity_exactness,ready_date,idempotency_key,metadata)
  values(v_ready_id,v_farm_id,v_prep_id,'conditioned_bucket',1,'bucket_equivalent','exact',current_date,'p10-cancel-ready-'||v_ready_id::text,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  perform atlas.reconcile_crop_cycle_requirement_state_v1(v_cycle_id);
  v_target_before:=atlas.crop_harvest_commercial_target_state_v1(v_cycle_id);
  select count(*)::int into v_open_before
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle_id
    and i.consequence_role='truth_acquisition'
    and i.action_key='choose_harvest_disposition'
    and i.status='open';

  if v_target_before->>'state' <> 'decision_required' or v_open_before <> 1 then
    raise exception 'Fixture should begin with one open commercial decision gap. target=% open=%',v_target_before,v_open_before;
  end if;

  insert into atlas.flower_sale_orders(id,farm_id,customer_label,sales_channel,sale_date,fulfillment_mode,subtotal_amount,tax_amount,tip_amount,total_amount,currency,idempotency_key,recorded_by_membership_id,metadata)
  values(v_sale_id,v_farm_id,'P10 cancellation buyer','farm_pickup',current_date,'immediate_handoff',30,0,0,30,'USD','p10-cancel-sale-'||v_sale_id::text,v_member_id,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  insert into atlas.flower_sale_order_lines(farm_id,sale_order_id,ready_lot_id,inventory_kind,quantity,unit,unit_price,metadata)
  values(v_farm_id,v_sale_id,v_ready_id,'conditioned_bucket',1,'bucket_equivalent',30,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  v_target_after_sale:=atlas.crop_harvest_commercial_target_state_v1(v_cycle_id);
  select count(*)::int into v_open_after_sale
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle_id
    and i.consequence_role='truth_acquisition'
    and i.action_key='choose_harvest_disposition'
    and i.status='open';

  if v_target_after_sale->>'state' <> 'target_established' or v_open_after_sale <> 0 then
    raise exception 'Noncancelled sale should resolve the commercial decision gap. target=% open=%',v_target_after_sale,v_open_after_sale;
  end if;

  insert into atlas.flower_sale_order_cancellation_events(farm_id,sale_order_id,reason_kind,note,recorded_by_membership_id,idempotency_key,metadata)
  values(v_farm_id,v_sale_id,'customer_cancelled','rollback cancellation proof',v_member_id,'p10-cancel-event-'||v_sale_id::text,jsonb_build_object('test_fixture','p10_cancelled_sale_reopens_gap'));

  v_target_after_cancel:=atlas.crop_harvest_commercial_target_state_v1(v_cycle_id);
  v_state_after_cancel:=atlas.crop_harvest_realization_state_v1(v_cycle_id);
  select count(*)::int into v_open_after_cancel
  from atlas.state_consequence_instances i
  where i.subject_kind='crop_cycle'
    and i.subject_id=v_cycle_id
    and i.consequence_role='truth_acquisition'
    and i.action_key='choose_harvest_disposition'
    and i.status='open';

  if v_target_after_cancel->>'state' <> 'decision_required'
     or (v_target_after_cancel->>'targetCount')::int <> 0 then
    raise exception 'Cancelled sale remained target evidence. target=%',v_target_after_cancel;
  end if;

  if v_open_after_cancel <> 1 then
    raise exception 'Cancellation did not reopen exactly one commercial decision gap. open=%',v_open_after_cancel;
  end if;

  if (v_state_after_cancel#>>'{summary,activeSaleOrderCount}')::int <> 0
     or (v_state_after_cancel#>>'{summary,fulfilledSaleOrderCount}')::int <> 0 then
    raise exception 'Cancelled sale remained active in realization state. state=%',v_state_after_cancel;
  end if;

  if (v_state_after_cancel#>>'{commercialRealization,directCommittedRevenue}')::numeric <> 0
     or (v_state_after_cancel#>>'{commercialRealization,directRealizedRevenue}')::numeric <> 0 then
    raise exception 'Cancelled sale retained crop revenue. state=%',v_state_after_cancel;
  end if;

  if v_state_after_cancel#>>'{summary,realizationClass}' <> 'ready_inventory_exists' then
    raise exception 'After cancellation, realization should fall back to Ready inventory. state=%',v_state_after_cancel;
  end if;
end;
$proof$;

rollback;
