import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804030500_germination_completion_dedup.sql", import.meta.url),
  "utf8",
);

test("resolved crop-cycle germination suppresses every equivalent active check", () => {
  assert.match(migration, /germination_task_crop_cycle_id_v1/);
  assert.match(migration, /p_task\.generated_from = 'crop_cycle_milestone'/);
  assert.match(migration, /p_task\.metadata ->> 'crop_cycle_id'/);
  assert.match(migration, /from atlas\.task_crop_cycles/);
  assert.match(migration, /germination_checked_date is not null/);
  assert.match(migration, /archive_resolved_germination_tasks_v1/);
  assert.match(migration, /after update of germination_checked_date, cycle_state/);
  assert.match(migration, /after insert or update of status, generated_from, generated_from_id, metadata, action_key, task_type/);
});

test("germination dedup uses structured crop-cycle identity before the legacy fallback", () => {
  const cycleIdentity = migration.indexOf("v_cycle_id := atlas.germination_task_crop_cycle_id_v1(new)");
  const legacyFallback = migration.indexOf("Legacy fallback");

  assert.ok(cycleIdentity >= 0);
  assert.ok(legacyFallback > cycleIdentity);
  assert.match(migration, /Duplicate germination event for crop cycle/);
  assert.match(migration, /migration_repair_v1/);
});
