import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811214000_atlas_field_transplant_readiness_observation_v1.sql", import.meta.url),
  "utf8",
);

test("generated transplant readiness is internal provenance delivered as a Day observation", () => {
  assert.match(migration, /new\.task_type='transplant_readiness'/);
  assert.match(migration, /new\.visibility_scope:='system_internal'/);
  assert.match(migration, /'observation_delivery_mode','day_cue'/);
  assert.match(migration, /'readiness_target','field_transplant'/);
  assert.match(migration, /service_date,cue_kind,anchor_kind/);
  assert.match(migration, /'observation','first_open'/);
  assert.match(migration, /Are the '\|\|v_subject\|\|' seedlings ready to plant out\?'/);
});

test("field-transplant readiness records reality without inventing a planting task", () => {
  const fieldExecutor = migration.split("create or replace function atlas.apply_worker_day_field_transplant_readiness_v1")[1]
    .split("-- Route only the new field-transplant contract")[0];

  assert.match(fieldExecutor, /'ready','not_ready','already_planted','problem'/);
  assert.match(fieldExecutor, /when v_readiness='ready' then 'transplant_ready'/);
  assert.match(fieldExecutor, /when v_readiness='already_planted' then 'transplanted_location_unconfirmed'/);
  assert.match(fieldExecutor, /atlas\.next_worker_day_v1/);
  assert.match(fieldExecutor, /record_task_transition_v1_internal/);
  assert.match(fieldExecutor, /'taskReleased',false/);
  assert.match(fieldExecutor, /truthful destination and any remaining farm-state gates/);
  assert.doesNotMatch(fieldExecutor, /insert into atlas\.tasks/i);
  assert.doesNotMatch(fieldExecutor, /readyMoveAction|pot_up/);
});

test("worker cue resolver routes the new contract without changing historical pot-up behavior", () => {
  assert.match(migration, /v_kind='field_transplant_readiness_gate_v1'/);
  assert.match(migration, /apply_worker_day_field_transplant_readiness_v1/);
  assert.match(migration, /apply_worker_day_cue_result_contract_v1/);
  assert.doesNotMatch(migration, /rename to apply_worker_day_pot_up_readiness_contract_v1/);
});

test("open readiness sources are backfilled into crop-cycle-linked cues", () => {
  assert.match(migration, /resolve_transplant_readiness_crop_cycle_v1/);
  assert.match(migration, /sync_task_crop_cycle_links_v1/);
  assert.match(migration, /sync_transplant_readiness_day_cue_v1/);
  assert.match(migration, /where task\.task_type='transplant_readiness'[\s\S]*task\.status='open'/);
});
