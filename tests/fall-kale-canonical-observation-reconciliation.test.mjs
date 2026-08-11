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
  assert.match(migration, /task_crop_cycles/);
  assert.match(migration, /'observes'/);
  assert.match(migration, /'already_potted'/);
  assert.match(migration, /canonical_state_reconciliation/);
  assert.match(normalized, /update atlas\.worker_day_cues cue set status='resolved'/i);
});

test("the reconciliation does not manufacture a new pot-up task or mutate the crop cycle backward", () => {
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.crop_cycles/i);
  assert.doesNotMatch(migration, /cycle_state\s*=/i);
});
