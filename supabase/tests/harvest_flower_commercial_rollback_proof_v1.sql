-- Harvest commercial production-shaped proof v1.
--
-- Run only after the Pass 5 + reversal migrations have been staged in the SAME transaction.
-- This script deliberately creates synthetic Harvest/Prepare/Ready/commercial data and
-- temporarily suppresses unrelated unreleased Elm occurrences so the fulfillment release
-- test is deterministic. The harness MUST ROLLBACK the transaction afterward.
--
-- This is behavior proof, not production data migration.

DO $proof$
DECLARE
  v_farm constant uuid := '6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f';
  v_anna constant uuid := '23e98e5e-16ca-40d8-872c-c77e06baa167';
  v_owner constant uuid := '5eba786d-57f1-40dc-8433-7fe037cfe600';
  v_wrong_farm_membership constant uuid := '8d4975f9-04a4-4906-8921-084ee74c3700';
  v_task constant uuid := 'f6bcdc5f-60aa-47f0-b5ff-1aea9bb3669f';
  v_cycle constant uuid := 'e79488a6-1f76-4089-99e3-57a74cc640a2';
  v_today date := (now() at time zone 'America/Chicago')::date;
  v_due date := ((now() at time zone 'America/Chicago')::date + 2);
  v_batch uuid;
  v_observation uuid;
  v_preparation uuid;
  v_ready uuid;
  v_sale_a uuid;
  v_sale_b uuid;
  v_occurrence_b uuid;
  v_task_b uuid;
  v_result jsonb;
  v_available numeric;
  v_count integer;
  v_state text;
  v_status text;
  v_expected boolean;
BEGIN
  -- Build a lawful synthetic physical lineage on top of an existing Elm task ↔ crop-cycle link.
  INSERT INTO atlas.flower_harvest_batches(
    farm_id,harvest_date,recorded_by_membership_id,batch_key,note,metadata
  ) VALUES (
    v_farm,v_today,v_anna,'rollback-proof:harvest:'||gen_random_uuid()::text,
    'Rollback-only commercial proof',jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_batch;

  INSERT INTO atlas.flower_harvest_bucket_observations(
    farm_id,batch_id,crop_cycle_id,task_id,recorded_by_membership_id,observed_date,
    bucket_band,bucket_equivalent_floor,more_available,note,idempotency_key,metadata
  ) VALUES (
    v_farm,v_batch,v_cycle,v_task,v_anna,v_today,
    'one',1.00,false,'Rollback-only commercial proof',
    'rollback-proof:harvest-observation:'||gen_random_uuid()::text,
    jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_observation;

  INSERT INTO atlas.flower_preparation_batches(
    farm_id,harvest_batch_id,task_id,prepared_date,recorded_by_membership_id,
    result_kind,note,idempotency_key,metadata
  ) VALUES (
    v_farm,v_batch,v_task,v_today,v_anna,'ready','Rollback-only commercial proof',
    'rollback-proof:preparation:'||gen_random_uuid()::text,
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
    'rollback-proof:ready:'||gen_random_uuid()::text,
    jsonb_build_object('rollbackProof',true)
  ) RETURNING id INTO v_ready;

  IF atlas.flower_ready_available_quantity_v1(v_ready) <> 10 THEN
    RAISE EXCEPTION 'proof: expected 10 Ready bouquets at birth';
  END IF;

  -- Scheduled sale A claims 4 of 10 and must be remembered without becoming executable today.
  v_result := atlas.record_flower_sale_core_v2(
    v_farm,v_owner,'owner',null,'Rollback Customer A','farm_pickup','rollback-proof-a',
    jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',4,'unitPrice',10)),
    0,0,'pickup',v_due,null,v_anna,null,'Rollback-only sale A',
    'rollback-proof:sale-a:'||gen_random_uuid()::text,false
  );
  v_sale_a := (v_result->>'saleOrderId')::uuid;

  v_available := atlas.flower_ready_available_quantity_v1(v_ready);
  IF v_available <> 6 THEN RAISE EXCEPTION 'proof: sale A should reduce Available to 6, got %',v_available; END IF;

  SELECT id INTO v_occurrence_b
  FROM atlas.planned_work_occurrences
  WHERE source_kind='flower_sale_order' AND source_id=v_sale_a;
  IF v_occurrence_b IS NULL THEN RAISE EXCEPTION 'proof: scheduled sale A did not create fulfillment occurrence'; END IF;
  IF EXISTS (SELECT 1 FROM atlas.planned_work_occurrences WHERE id=v_occurrence_b AND released_task_id IS NOT NULL) THEN
    RAISE EXCEPTION 'proof: future sale A incorrectly released fulfillment work today';
  END IF;

  -- Sequential overclaim proof. v2 has deterministic Ready FOR UPDATE locks for true concurrent callers;
  -- a second session cannot observe these uncommitted migration tables, so cross-session concurrency is
  -- source-proved and this transaction exercises the same post-lock availability rejection sequentially.
  BEGIN
    PERFORM atlas.record_flower_sale_core_v2(
      v_farm,v_owner,'owner',null,'Rollback Overclaim','market','rollback-overclaim',
      jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',7,'unitPrice',10)),
      0,0,'immediate_handoff',null,null,null,null,'Must reject',
      'rollback-proof:overclaim:'||gen_random_uuid()::text,false
    );
    RAISE EXCEPTION 'proof: overclaim unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT ILIKE '%Available%' THEN RAISE; END IF;
  END;

  -- Cancel A: original sale persists, cancellation is appended, and its claim becomes Available again.
  v_result := atlas.cancel_flower_sale_core_v1(
    v_farm,v_sale_a,v_owner,'owner','customer_cancelled','Rollback cancellation',
    'rollback-proof:cancel-a:'||gen_random_uuid()::text,false
  );
  IF NOT EXISTS (SELECT 1 FROM atlas.flower_sale_orders WHERE id=v_sale_a) THEN RAISE EXCEPTION 'proof: cancellation deleted original sale'; END IF;
  IF NOT EXISTS (SELECT 1 FROM atlas.flower_sale_order_cancellation_events WHERE sale_order_id=v_sale_a) THEN RAISE EXCEPTION 'proof: cancellation fact missing'; END IF;
  v_available := atlas.flower_ready_available_quantity_v1(v_ready);
  IF v_available <> 10 THEN RAISE EXCEPTION 'proof: cancellation should restore Available to 10, got %',v_available; END IF;
  SELECT state INTO v_state FROM atlas.planned_work_occurrences WHERE id=v_occurrence_b;
  IF v_state <> 'cancelled' THEN RAISE EXCEPTION 'proof: cancelled sale did not retire fulfillment occurrence, state %',v_state; END IF;

  -- Physical spoilage removes 2 without rewriting Ready birth truth.
  v_result := atlas.record_flower_ready_disposition_core_v1(
    v_farm,v_ready,v_anna,'farm_hand','spoilage',2,'Rollback spoilage',
    'rollback-proof:spoilage:'||gen_random_uuid()::text,false
  );
  v_available := atlas.flower_ready_available_quantity_v1(v_ready);
  IF v_available <> 8 THEN RAISE EXCEPTION 'proof: spoilage should reduce Available to 8, got %',v_available; END IF;
  IF (SELECT quantity FROM atlas.flower_ready_inventory_lots WHERE id=v_ready) <> 10 THEN RAISE EXCEPTION 'proof: disposition rewrote Ready birth quantity'; END IF;

  BEGIN
    PERFORM atlas.record_flower_ready_disposition_core_v1(
      v_farm,v_ready,v_anna,'farm_hand','donation',1,'Must reject',
      'rollback-proof:worker-donation:'||gen_random_uuid()::text,false
    );
    RAISE EXCEPTION 'proof: Farm Hand donation unexpectedly succeeded';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  BEGIN
    PERFORM atlas.record_flower_ready_disposition_core_v1(
      v_farm,v_ready,v_owner,'owner','write_off',9,'Must reject',
      'rollback-proof:over-disposition:'||gen_random_uuid()::text,false
    );
    RAISE EXCEPTION 'proof: over-disposition unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT ILIKE '%Available%' THEN RAISE; END IF;
  END;

  -- Wrong-farm membership cannot record an Elm sale.
  BEGIN
    PERFORM atlas.record_flower_sale_core_v2(
      v_farm,v_wrong_farm_membership,'owner',null,'Wrong farm','market','rollback-wrong-farm',
      jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',1,'unitPrice',10)),
      0,0,'immediate_handoff',null,null,null,null,'Must reject',
      'rollback-proof:wrong-farm:'||gen_random_uuid()::text,false
    );
    RAISE EXCEPTION 'proof: wrong-farm membership unexpectedly recorded Elm sale';
  EXCEPTION WHEN SQLSTATE '42501' THEN NULL; END;

  -- Sale B claims 5 of the remaining 8 and will be used to prove due-date release + actual handoff.
  v_result := atlas.record_flower_sale_core_v2(
    v_farm,v_owner,'owner',null,'Rollback Customer B','farm_pickup','rollback-proof-b',
    jsonb_build_array(jsonb_build_object('readyLotId',v_ready,'quantity',5,'unitPrice',10)),
    0,0,'pickup',v_due,null,v_anna,null,'Rollback-only sale B',
    'rollback-proof:sale-b:'||gen_random_uuid()::text,false
  );
  v_sale_b := (v_result->>'saleOrderId')::uuid;
  v_available := atlas.flower_ready_available_quantity_v1(v_ready);
  IF v_available <> 3 THEN RAISE EXCEPTION 'proof: sale B should reduce Available to 3, got %',v_available; END IF;

  SELECT id,released_task_id INTO v_occurrence_b,v_task_b
  FROM atlas.planned_work_occurrences
  WHERE source_kind='flower_sale_order' AND source_id=v_sale_b;
  IF v_occurrence_b IS NULL THEN RAISE EXCEPTION 'proof: sale B fulfillment occurrence missing'; END IF;
  IF v_task_b IS NOT NULL THEN RAISE EXCEPTION 'proof: future sale B incorrectly executable today'; END IF;

  -- Isolate this proof from unrelated unreleased Elm backlog; ROLLBACK restores every row.
  UPDATE atlas.planned_work_occurrences
  SET state='cancelled',metadata=coalesce(metadata,'{}'::jsonb)||jsonb_build_object('rollbackProofIsolation',true),updated_at=now()
  WHERE farm_id=v_farm AND id<>v_occurrence_b AND state IN ('planned','eligible','failed');

  PERFORM atlas.release_eligible_work_v1(v_farm,v_today,25);
  SELECT released_task_id INTO v_task_b FROM atlas.planned_work_occurrences WHERE id=v_occurrence_b;
  IF v_task_b IS NOT NULL THEN RAISE EXCEPTION 'proof: future fulfillment released before due date'; END IF;

  PERFORM atlas.release_eligible_work_v1(v_farm,v_due,25);
  SELECT released_task_id INTO v_task_b FROM atlas.planned_work_occurrences WHERE id=v_occurrence_b;
  IF v_task_b IS NULL THEN RAISE EXCEPTION 'proof: due fulfillment did not release into Worker Day'; END IF;

  v_result := atlas.record_flower_fulfillment_core_v1(
    v_task_b,v_anna,'farm_hand','Rollback actual handoff',
    'rollback-proof:fulfillment-b:'||gen_random_uuid()::text,false
  );
  IF NOT EXISTS (SELECT 1 FROM atlas.flower_fulfillment_events WHERE sale_order_id=v_sale_b AND task_id=v_task_b) THEN
    RAISE EXCEPTION 'proof: actual handoff event missing';
  END IF;
  SELECT status INTO v_status FROM atlas.tasks WHERE id=v_task_b;
  IF v_status NOT IN ('done','completed') THEN RAISE EXCEPTION 'proof: canonical fulfillment task did not complete, status %',v_status; END IF;

  BEGIN
    PERFORM atlas.cancel_flower_sale_core_v1(
      v_farm,v_sale_b,v_owner,'owner','entry_correction','Must reject after fulfillment',
      'rollback-proof:cancel-fulfilled:'||gen_random_uuid()::text,false
    );
    RAISE EXCEPTION 'proof: fulfilled sale cancellation unexpectedly succeeded';
  EXCEPTION
    WHEN SQLSTATE '22023' THEN
      IF SQLERRM NOT ILIKE '%fulfilled%' THEN RAISE; END IF;
  END;

  -- RLS / grants: signed-in clients can read truth tables but cannot mutate them directly.
  IF NOT has_table_privilege('authenticated','atlas.flower_sale_orders','SELECT')
     OR has_table_privilege('authenticated','atlas.flower_sale_orders','INSERT')
     OR NOT has_table_privilege('authenticated','atlas.flower_sale_order_cancellation_events','SELECT')
     OR has_table_privilege('authenticated','atlas.flower_sale_order_cancellation_events','INSERT')
     OR NOT has_table_privilege('authenticated','atlas.flower_ready_inventory_disposition_events','SELECT')
     OR has_table_privilege('authenticated','atlas.flower_ready_inventory_disposition_events','INSERT') THEN
    RAISE EXCEPTION 'proof: authenticated table privilege membrane is incorrect';
  END IF;

  IF has_function_privilege('authenticated','atlas.cancel_flower_sale_core_v1(uuid,uuid,uuid,text,text,text,text,boolean)','EXECUTE')
     OR NOT has_function_privilege('authenticated','atlas.cancel_flower_sale_for_member_v1(uuid,uuid,text,text,text)','EXECUTE')
     OR has_function_privilege('authenticated','atlas.record_flower_ready_disposition_core_v1(uuid,uuid,uuid,text,text,numeric,text,text,boolean)','EXECUTE')
     OR NOT has_function_privilege('authenticated','atlas.record_flower_ready_disposition_for_member_v1(uuid,uuid,text,numeric,text,text)','EXECUTE') THEN
    RAISE EXCEPTION 'proof: authenticated function privilege membrane is incorrect';
  END IF;

  SELECT count(*) INTO v_count FROM atlas.authenticated_rpc_registry_drift_v1();
  IF v_count<>0 THEN RAISE EXCEPTION 'proof: authenticated RPC registry drift count is %',v_count; END IF;

  RAISE NOTICE 'HARVEST_COMMERCIAL_ROLLBACK_PROOF_OK ready=% saleA=% saleB=% fulfillmentTask=%',v_ready,v_sale_a,v_sale_b,v_task_b;
END
$proof$;
