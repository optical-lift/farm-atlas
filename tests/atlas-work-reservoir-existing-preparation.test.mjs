import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260803164500_skip_releasing_already_prepared_bed_work.sql", import.meta.url),
  "utf8",
);

test("bed preparation already evidenced on the object completes the occurrence instead of releasing a task", () => {
  assert.match(migration, /work_occurrence_existing_preparation_v1/);
  assert.match(migration, /object_activity_events/);
  assert.match(migration, /ready_for_sowing/);
  assert.match(migration, /e\.created_at >= o\.created_at/);
  assert.match(migration, /e\.created_at::date <= o\.planned_due_date/);
  assert.match(migration, /state = ''completed''/);
  assert.match(migration, /completedByExistingObjectState/);
  assert.match(migration, /continue;/);
});

test("the release engine is patched idempotently and fails loudly if its contract changes", () => {
  assert.match(migration, /position\('work_occurrence_existing_preparation_v1\(v_row\.id\)' in v_definition\) = 0/);
  assert.match(migration, /Could not add existing-preparation guard/);
  assert.match(migration, /pg_get_function_identity_arguments/);
});
