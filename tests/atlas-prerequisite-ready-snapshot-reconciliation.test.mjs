import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812020000_prerequisite_ready_snapshot_reconciliation_v1.sql", import.meta.url),
  "utf8",
);

test("known dependency-only chains restore to open after prerequisites finish", () => {
  for (const key of [
    "owner_price_cutter_local_products_application",
    "owner_build_price_cutter_flower_test_offer",
    "anna_20260817_transplant_fall_lettuce_entry_billboard",
    "anna_20260817_transplant_fall_spinach_entry_billboard",
  ]) {
    assert.match(migration, new RegExp(key));
  }
  assert.match(migration, /\{prerequisite_gate_restore,status\}/);
  assert.match(migration, /'"open"'::jsonb/);
  assert.match(migration, /\{prerequisite_gate_restore,blocker_text\}/);
  assert.match(migration, /perform|reconcile_task_prerequisite_gate_v1/);
});

test("crop transplant repair proves both canonical prerequisite edges match task metadata", () => {
  assert.match(migration, /reset_prerequisite_task_id/);
  assert.match(migration, /readiness_prerequisite_task_id/);
  assert.match(migration, /having count\(\*\)=2/);
});

test("external approval remains a separate legitimate blocker", () => {
  assert.match(migration, /anna_run_first_price_cutter_flower_test/);
  assert.match(migration, /external_gate/);
  assert.match(migration, /blocked restore is intentionally preserved/);
});

test("repair fails closed if prerequisite shape has drifted", () => {
  assert.match(migration, /expected % active prerequisites, found %/);
  assert.match(migration, /now has an external gate/);
  assert.match(migration, /no longer matches both canonical edges/);
});

test("no generated task ids are embedded in the reconciliation", () => {
  assert.doesNotMatch(migration, /dec62434-58f9-4322-a521-a4141f715c6e/i);
  assert.doesNotMatch(migration, /da88426f-a036-44f5-904e-1a1a61c914d5/i);
  assert.doesNotMatch(migration, /f41fdede-74a6-44f6-b8ea-e8b92fe5e4a3/i);
  assert.doesNotMatch(migration, /7e06d120-e773-4d9e-b45c-8f34ca10ad05/i);
});
