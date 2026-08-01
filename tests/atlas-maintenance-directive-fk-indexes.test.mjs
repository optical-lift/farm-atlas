import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801043400_atlas_maintenance_directive_fk_indexes_v1.sql", import.meta.url),
  "utf8",
);

test("every maintenance-directive foreign key has a full leading-column index", () => {
  for (const indexName of [
    "maintenance_directives_organization_id_idx",
    "maintenance_directives_created_by_user_id_idx",
    "maintenance_directives_completed_by_user_id_idx",
    "maintenance_directive_steps_completed_by_user_id_idx",
  ]) {
    assert.match(migration, new RegExp(indexName));
  }

  for (const column of [
    "organization_id",
    "farm_id",
    "object_id",
    "weed_card_id",
    "rhythm_state_id",
    "assigned_membership_id",
    "serving_task_id",
    "prerequisite_task_id",
    "created_by_user_id",
    "completed_by_user_id",
    "directive_id",
    "crop_cycle_id",
  ]) {
    assert.match(migration, new RegExp(`'${column}'`));
  }

  assert.match(migration, /attribute\.attnum = index_row\.indkey\[0\]/);
  assert.match(migration, /index_row\.indpred is null/);
  assert.match(migration, /Maintenance directive FK index postcondition failed/);
});

test("index migration remains scoped to Atlas maintenance directives", () => {
  assert.doesNotMatch(migration, /buyer|titus|draft_/i);
  assert.doesNotMatch(migration, /drop index/i);
});
