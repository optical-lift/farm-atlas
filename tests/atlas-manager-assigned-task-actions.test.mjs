import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  AtlasTaskTransitionInputError,
  atlasTaskTransitionRpcForRole,
} from "../lib/atlas/task-transition-core.js";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("managers and Farm Hands use the assigned-worker task engine", () => {
  for (const role of ["farm_hand", "manager"]) {
    assert.equal(atlasTaskTransitionRpcForRole(role, "done"), "worker_record_task_transition_v1");
    assert.equal(atlasTaskTransitionRpcForRole(role, "partial"), "worker_record_task_transition_v1");
    assert.equal(atlasTaskTransitionRpcForRole(role, "blocked"), "worker_record_task_transition_v1");
    assert.equal(atlasTaskTransitionRpcForRole(role, "rescheduled"), "worker_record_task_transition_v1");
    assert.equal(atlasTaskTransitionRpcForRole(role, "changed_plan"), "worker_record_task_transition_v1");
  }

  assert.equal(atlasTaskTransitionRpcForRole("owner", "done"), "owner_record_task_transition_v1");
});

test("unrecognized roles remain unable to mutate tasks", () => {
  assert.throws(
    () => atlasTaskTransitionRpcForRole("guest", "done"),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.code === "task_transition_role_not_allowed",
  );
});

test("database boundary still requires the signed-in membership assignment", () => {
  const migration = read("supabase/migrations/20260722183500_allow_managers_to_operate_assigned_tasks.sql");
  const core = read("lib/atlas/task-transition-core.js");

  assert.match(migration, /v_role not in \('farm_hand', 'manager'\)/);
  assert.match(migration, /v_visibility_scope <> 'assigned_worker'/);
  assert.match(migration, /v_assigned_membership_id <> v_current_membership_id/);
  assert.match(migration, /'actor_role', v_role/);
  assert.doesNotMatch(core, /manager_transition_not_available/);
  assert.doesNotMatch(core, /Manager task changes are not enabled yet/);
});
