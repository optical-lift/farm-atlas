import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const occupancyRepair = readFileSync(
  "supabase/migrations/20260818033856_reconcile_terminal_occupancy_backfill_lifecycle_v1.sql",
  "utf8",
);
const observedRepair = readFileSync(
  "supabase/migrations/20260818034128_reconcile_observed_terminal_crop_cycle_lifecycle_v1.sql",
  "utf8",
);

test("occupancy repair is provenance-scoped to terminal July occupancy imports", () => {
  assert.match(occupancyRepair, /lifecycle_status='active'/i);
  assert.match(occupancyRepair, /cycle_state in \('failed','abandoned','archived'\)/i);
  assert.match(occupancyRepair, /metadata->>'source'='crop_occupancy_backfill_v1'/i);
  assert.match(occupancyRepair, /lifecycle_status='archived'/i);
  assert.match(occupancyRepair, /preservedCycleState/i);
  assert.doesNotMatch(occupancyRepair, /failed_germination/i);
});

test("observed germination failures terminate only the failed cycle and do not infer resow", () => {
  assert.match(observedRepair, /cycle_state='failed_germination'/i);
  assert.match(observedRepair, /germination_checked_date is not null/i);
  assert.match(observedRepair, /source_task_id is not null/i);
  assert.match(observedRepair, /metadata->>'source' in \('owner_report','owner_photo_audit'\)/i);
  assert.match(observedRepair, /any resow is a separate future cycle and is not inferred here/i);
  assert.match(observedRepair, /'futureResowDecisionInferred',false/i);
});

test("absent crop stand repair requires high-confidence physical evidence", () => {
  assert.match(observedRepair, /cycle_state='absent'/i);
  assert.match(observedRepair, /field_rows_photo_truth_pass_20260712/i);
  assert.match(observedRepair, /stand_quality'='failed_or_absent/i);
  assert.match(observedRepair, /registry_confidence'='high/i);
  assert.match(observedRepair, /crop_occupancy_evidence/i);
  assert.match(observedRepair, /evidence_role='observation'/i);
  assert.match(observedRepair, /confidence='high'/i);
  assert.match(observedRepair, /metadata->>'stage'='absent'/i);
});

test("lifecycle reconciliation uses no generated row ids or farm ids", () => {
  for (const migration of [occupancyRepair, observedRepair]) {
    assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  }
});