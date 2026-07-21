import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath = "supabase/migrations/20260721051235_atlas_restore_worker_unfinished_transitions.sql";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker transition migration restores familiar outcomes without widening assignment scope", () => {
  const migration = read(migrationPath);

  for (const transition of [
    "done",
    "partial",
    "blocked",
    "not_relevant",
    "changed_plan",
    "rescheduled",
    "unfinished",
    "checklist_done",
    "checklist_open",
    "note",
  ]) {
    assert.match(migration, new RegExp(`'${transition}'`));
  }

  assert.match(migration, /v_visibility_scope <> 'assigned_worker'/);
  assert.match(migration, /v_assigned_membership_id <> v_current_membership_id/);
  assert.match(migration, /v_role <> 'farm_hand'/);
  assert.match(migration, /p_target_date/);
  assert.match(migration, /revoke execute .* from public, anon/i);
  assert.match(migration, /grant execute .* to authenticated, service_role/i);
});
