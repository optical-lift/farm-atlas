-- Harvest Pass 6 reconciliation production-shaped proof v1.
--
-- Run only after 20260815144000_harvest_flower_reconciliation_v1.sql has been staged
-- in the SAME transaction. This proof creates synthetic Harvest -> Prepare -> Ready ->
-- Sale -> correction facts and MUST be rolled back by the harness.

DO $proof$
DECLARE
  v_farm constant uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f';
  v_anna constant uuid := '23e98e5e-16ca-40d8-872c-c77e06baa167';
  v_owner constant uuid := '5eba786d-57f1-40dc-8433-7fe037cfe600';
  v_task constant uuid := 'f6bcdc5f-60aa-47f0-b5ff-1aea9bb3669f';
  v_cycle constant uuid := 'e79488a6-1f76-4089-99e3-57a74cc640a2';
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_batch uuid;
  v_observation uuid;
  v_preparation uuid;
  v_ready uuid;
  v_sale_b uuid;
  v_result jsonb;
  v_score atlas.flower_commercial_farm_score_v1%rowtype;
  v_position atlas.flower_ready_inventory_position_v1%rowtype;
  v_evidence atlas.flower_harvest_production_evidence_v1%rowtype;
BEGIN
  INSERT INTO atlas.flower_harvest_batches(
    farm_id,harvest_date,recorded_by_membership_id,batch_key,note,metadata
  ) VALUES (
    v_farm,v_today,v_anna,'reconciliation-proof:harvest:'||gen_random_uuid()::text,
    'Rollback-only reconciliation proof',jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_batch;

  INSERT INTO atlas.flower_harvest_bucket_observations(
    farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
    bucket_band,bucket_equivalent_floor,more_available,note,idempotency_key,metadata
  ) VALUES (
    v_farm,v_batch,v_cycle,v_task,v_anna,v_today,
    'one',1.00,false,'Rollback-only reconciliation proof',
    'reconciliation-proof:observation:'||gen_random_uuid()::text,
    jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_observation;

  INSERT INTO atlas.flower_preparation_batches(
    farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,
    result_kind,note,idempotency_key,metadata
  ) VALUES (
    v_farm,v_batch,v_task,v_today,v_anna,'ready','Rollback-only reconciliation proof',
    'reconciliation-proof:preparation:'||gen_random_uuid()::text,
    jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_preparation;

  INSERT INTO atlas.flower_preparation_inputs(
    farm_id,preparation_batch_id,harvest_observation_id,
    source_bucket_band,source_bucket_equivalent_floor,source_lower_bound
  ) VALUES (v_farm,v_preparation,v_observation,'one',1.00,false);

  INSERT INTO atlas.flower_ready_inventory_lots(
    farm_id,preparation_batch_id,inventory_kind,quantity,unit,quantity_exactness,
    ready_date,idempotency_key,metadata
  ) VALUES (
    v_farm,v_preparation,'bouquet',10,'bouquet','exact',v_today,
    'reconciliation-proof:ready:'||gen_random_uuid()::text,
    jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_ready;

  IF (SELECT retail_unit_value FROM atlas.flower_ready_inventory_lots WHERE id=v_ready) <> 25 THEN
    RAISE EXCEPTION 'proof: Ready bouquet did not snapshot $25 retail value';
  END IF;

  PERFORM atlas.record_flower_sale_core_v2(
    v_farm,v_owner,'owner',null,'Reconciliation Customer A','market','reconciliation-proof-a',
    jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',4,'unitPrice',20)),
    0,0,'immediate_handoff',null,null,null,null,'Rollback-only immediate handoff',
    'reconciliation-proof:sale-a:'||gen_random_uuid()::text,false
  );

  v_result := atlas.record_flower_sale_core_v2(
    v_farm,v_owner,'owner',null,'Reconciliation Customer B','farm_pickup','reconciliation-proof-b',
    jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',3,'unitPrice',25)),
    0,0,'pickup',v_today+2,null,v_anna,null,'Rollback-only scheduled pickup',
    'reconciliation-proof:sale-b:'||gen_random_uuid()::text,false
  );
  v_sale_b := (v_result->>'saleOrderId')::uuid;

  SELECT * INTO v_score FROM atlas.flower_commercial_farm_score_v1 WHERE farm_id=v_farm;
  IF v_score.priced_prepared_retail_value<>250
     OR v_score.priced_claimed_retail_value<>175
     OR v_score.sell_through_pct<>70.0 THEN
    RAISE EXCEPTION 'proof: initial sell-through mismatch prepared %, claimed %, pct %',
      v_score.priced_prepared_retail_value,v_score.priced_claimed_retail_value,v_score.sell_through_pct;
  END IF;
  IF v_score.committed_revenue<>155
     OR v_score.realized_revenue<>80
     OR v_score.realized_product_revenue<>80 THEN
    RAISE EXCEPTION 'proof: revenue mismatch committed %, realized %, product %',
      v_score.committed_revenue,v_score.realized_revenue,v_score.realized_product_revenue;
  END IF;

  PERFORM atlas.cancel_flower_sale_core_v1(
    v_farm,v_sale_b,v_owner,'owner','customer_cancelled','Rollback cancellation',
    'reconciliation-proof:cancel-b:'||gen_random_uuid()::text,false
  );
  PERFORM atlas.record_flower_ready_disposition_core_v1(
    v_farm,v_ready,v_anna,'farm_hand','spoilage',2,'Rollback spoilage',
    'reconciliation-proof:spoilage:'||gen_random_uuid()::text,false
  );

  SELECT * INTO v_position FROM atlas.flower_ready_inventory_position_v1 WHERE id=v_ready;
  IF v_position.active_claimed_quantity<>4
     OR v_position.fulfilled_quantity<>4
     OR v_position.disposed_quantity<>2
     OR v_position.available_quantity<>4 THEN
    RAISE EXCEPTION 'proof: Ready position mismatch claim %, fulfilled %, disposed %, available %',
      v_position.active_claimed_quantity,v_position.fulfilled_quantity,v_position.disposed_quantity,v_position.available_quantity;
  END IF;

  SELECT * INTO v_score FROM atlas.flower_commercial_farm_score_v1 WHERE farm_id=v_farm;
  IF v_score.sell_through_pct<>40.0
     OR v_score.committed_revenue<>80
     OR v_score.realized_revenue<>80
     OR v_score.cancelled_order_count<1
     OR v_score.priced_disposed_retail_value<>50 THEN
    RAISE EXCEPTION 'proof: post-correction score mismatch pct %, committed %, realized %, cancelled %, disposed %',
      v_score.sell_through_pct,v_score.committed_revenue,v_score.realized_revenue,
      v_score.cancelled_order_count,v_score.priced_disposed_retail_value;
  END IF;

  SELECT * INTO v_evidence
  FROM atlas.flower_harvest_production_evidence_v1
  WHERE harvest_observation_id=v_observation;
  IF v_evidence.production_link_state<>'unlinked'
     OR v_evidence.conversion_attribution_state<>'direct_single_observation'
     OR v_evidence.directly_attributable_prepared_retail_value<>250
     OR v_evidence.directly_attributable_realized_product_revenue<>80 THEN
    RAISE EXCEPTION 'proof: Production evidence mismatch link %, conversion %, prepared %, realized %',
      v_evidence.production_link_state,v_evidence.conversion_attribution_state,
      v_evidence.directly_attributable_prepared_retail_value,
      v_evidence.directly_attributable_realized_product_revenue;
  END IF;

  RAISE NOTICE 'HARVEST_RECONCILIATION_ROLLBACK_PROOF_OK ready=% sellThrough=% realized=%',
    v_ready,v_score.sell_through_pct,v_score.realized_revenue;
END
$proof$;