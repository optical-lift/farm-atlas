import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811231500_owner_day_capacity_reads_placements_v1.sql", import.meta.url),
  "utf8",
);
const atomic = readFileSync(
  new URL("../supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql", import.meta.url),
  "utf8",
);

test("Owner Day selection capacity starts from the placement-aware Day plan", () => {
  assert.match(migration, /v_plan:=atlas\.owner_worker_day_plan_choreographed_v1\(p_farm_id,p_membership_id,p_day\)/);
  assert.doesNotMatch(migration, /v_plan:=atlas\.owner_worker_day_plan_v1\(p_farm_id,p_membership_id,p_day\)/);
  assert.match(migration, /v_current:=coalesce\(\(v_plan->>'committedPaidMinutes'\)::integer,0\)/);
  assert.match(migration, /v_automatic:=coalesce\(\(v_plan->>'automaticPaidMinutes'\)::integer,0\)/);
});

test("the atomic purple commit applies placement edits before evaluating newly selected work", () => {
  const editIndex = atomic.indexOf("owner_apply_worker_day_edits_api_v1");
  const selectionIndex = atomic.indexOf("owner_build_worker_day_schedule_api_v2");
  assert.ok(editIndex >= 0);
  assert.ok(selectionIndex > editIndex);
});

test("project capacity override decisions include the already choreographed Day load", () => {
  assert.match(migration, /if v_current\+v_automatic\+v_selected>v_target then/);
  assert.match(migration, /pull_project_item_to_today_owner_override_v1/);
  assert.match(migration, /pull_project_item_to_today_v1/);
  assert.match(migration, /'alreadyCommittedPaidMinutes',v_current/);
  assert.match(migration, /'projectedPaidMinutes',v_current\+v_automatic\+v_selected/);
});

test("placement-aware capacity preserves the no-task-due-mutation rule for floating work", () => {
  assert.match(migration, /owner_apply_worker_day_edits_api_v1/);
  assert.match(migration, /'kind','place'/);
  assert.doesNotMatch(migration, /set\s+due_date\s*=\s*p_day/i);
});
