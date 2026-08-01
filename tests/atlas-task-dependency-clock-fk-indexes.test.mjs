import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801012220_atlas_task_dependency_clock_fk_indexes_v1.sql", import.meta.url),
  "utf8",
);

test("every dependency-clock foreign key has a full leading-column index", () => {
  for (const column of [
    "farm_id",
    "source_task_id",
    "source_transition_id",
    "downstream_occurrence_id",
    "downstream_task_id",
  ]) {
    assert.match(migration, new RegExp(`\\('${column}'\\)`));
  }

  assert.match(migration, /task_dependency_clocks_farm_id_idx/);
  assert.match(migration, /task_dependency_clocks_source_task_id_idx/);
  assert.match(migration, /task_dependency_clocks_source_transition_id_idx/);
  assert.match(migration, /task_dependency_clocks_downstream_task_idx/);
  assert.match(migration, /index_row\.indpred is null/);
  assert.match(migration, /attribute\.attnum = index_row\.indkey\[0\]/);
  assert.match(migration, /Dependency clock FK index postcondition failed/);
});

test("index cleanup stays scoped to the new dependency-clock table", () => {
  assert.doesNotMatch(migration, /drop index(?! if exists atlas\.task_dependency_clocks_downstream_task_idx)/i);
  assert.doesNotMatch(migration, /buyer|titus|draft_/i);
});
