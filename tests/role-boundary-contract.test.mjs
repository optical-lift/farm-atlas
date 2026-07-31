import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const roleProof = read("supabase/tests/atlas_role_boundaries_v1.sql");

test("role-boundary proof is transactional and fail-closed", () => {
  assert.match(roleProof, /^begin;/m);
  assert.match(roleProof, /where not passed/);
  assert.match(roleProof, /raise exception 'Atlas role-boundary tests failed/);
  assert.match(roleProof, /rollback;\s*$/);
});

test("owner, manager, worker, and wrong-farm boundaries are covered", () => {
  for (const testName of [
    "owner_can_list_members",
    "owner_can_operate_as_worker",
    "owner_universal_home_scope",
    "manager_cannot_list_members",
    "manager_worker_hand_is_read_only",
    "worker_can_read_elm_snapshot",
    "worker_cannot_read_other_farm",
    "worker_can_open_own_hand",
    "worker_cannot_open_other_farm_hand",
    "worker_cannot_enter_operator_mode",
    "worker_universal_home_scope",
  ]) {
    assert.match(roleProof, new RegExp(testName));
  }
});

test("authorization proof resolves live memberships instead of hardcoding IDs", () => {
  assert.match(roleProof, /from atlas\.farm_memberships/);
  assert.match(roleProof, /from atlas\.farms/);
  assert.match(roleProof, /request\.jwt\.claim\.sub/);
  assert.doesNotMatch(
    roleProof,
    /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i,
  );
});
