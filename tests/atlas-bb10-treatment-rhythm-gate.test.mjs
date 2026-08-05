import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260805005930_bb10_treatment_blocks_weed_rhythm_v1.sql");

test("BB10 weed rhythm waits for the treatment-complete prerequisite", () => {
  assert.match(migration, /stable_key = 'bb_10'/);
  assert.match(migration, /owner_20260825_confirm_bb10_treatment_complete/);
  assert.match(migration, /activationPrerequisiteTaskKey/);
  assert.match(migration, /active = false/);
  assert.match(migration, /state = 'paused'/);
  assert.match(migration, /three-pass Bermuda-grass treatment/);
  assert.match(migration, /record_task_transition_v1\([\s\S]*?'not_relevant'/);
  assert.match(migration, /state = 'cancelled'/);
});

test("deferred rhythm activation is generic and starts a fresh lease", () => {
  assert.match(migration, /activate_deferred_rhythm_bindings_after_task_v1/);
  assert.match(migration, /after update of status on atlas\.tasks/);
  assert.match(migration, /insert into atlas\.rhythm_satisfactions/);
  assert.match(migration, /activation_prerequisite_completed/);
  assert.match(migration, /lease_started_at = v_satisfied_at/);
  assert.match(migration, /evaluate_rhythm_binding_v1/);
});

test("the correction resolves stable records instead of embedding generated ids", () => {
  assert.doesNotMatch(migration, /c40f8d4a-4586-47ee-8000-df763ec0359e/);
  assert.doesNotMatch(migration, /f08be517-8305-4e92-9f00-c7ef8f282402/);
  assert.doesNotMatch(migration, /85445cb4-17e1-4c04-9152-e5d9c21206d0/);
});
