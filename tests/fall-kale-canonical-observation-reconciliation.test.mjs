import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811194500_atlas_fall_kale_canonical_reconciliation_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("stale Fall kale readiness is reconciled from canonical crop-cycle evidence instead of asking the worker again", () => {
  assert.match(migration, /fall_kale_seedling/);
  assert.match(migration, /source_sown_date/);
  assert.match(migration, /cycle_state in \('hardening_off','potted_up','transplanted','established'\)/i);
  assert.match(migration, /grow_room_seed_shelves/);
  assert.match(migration, /insert into atlas\.task_crop_cycles/i);
  assert.match(migration, /'observes'/);
  assert.match(migration, /'already_potted'/);
  assert.match(migration, /canonical_state_reconciliation/);
  assert.match(normalized, /update atlas\.worker_day_cues cue set response=jsonb_build_object/i);
  assert.match(normalized, /status='resolved'/i);
});

test("the reconciliation closes only the stale readiness source and does not manufacture or roll back crop work", () => {
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.crop_cycles/i);
  assert.doesNotMatch(migration, /set cycle_state/i);
});
