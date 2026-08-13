import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), "utf8");

test("Owner planning controls stay hidden until the Owner opens Edit today", () => {
  const gate = read("components/atlas/owner-day-plan-gate.tsx");
  assert.match(gate, /worker-day-plan/);
  assert.match(gate, /Edit today/);
  assert.match(gate, /Purple is a draft/);
  assert.match(gate, /\{open \? \(/);
  assert.match(gate, /<OwnerDayScheduleBuilder \/>/);
  assert.match(gate, /<OwnerDayCueEditor \/>/);
  assert.match(gate, /setOpen\(false\)/);
  assert.match(gate, /data-owner-day-starting-load/);
});

test("Owner Edit today reveals the starting paid-load budget without changing the worker Day", () => {
  const gate = read("components/atlas/owner-day-plan-gate.tsx");
  assert.match(gate, /paidTargetMinutes/);
  assert.match(gate, /committedPaidMinutes/);
  assert.match(gate, /automaticPaidMinutes/);
  assert.match(gate, /knownLoadMinutes/);
  assert.match(gate, /overByMinutes/);
  assert.match(gate, /Starting load/);
  assert.match(gate, /data-over-capacity/);
  assert.doesNotMatch(gate, /method:\s*"POST"/);
});

test("purple additions and inline Day changes remain drafts until one explicit atomic commit", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");
  assert.match(builder, /selectedAdds/);
  assert.match(builder, /selectedCandidates/);
  assert.match(builder, /selections: selectedCandidates\.map/);
  assert.match(builder, /sourceKind: candidate\.sourceKind/);
  assert.match(builder, /sourceId: candidate\.sourceId/);
  assert.match(builder, /owner-day-commit/);
  assert.match(builder, /owner-day-commit-v1/);
  assert.doesNotMatch(builder, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(builder, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.match(builder, /return_to_atlas/);
  assert.match(builder, /method: "POST"/);
  assert.match(builder, /window\.location\.reload/);
  assert.match(builder, /applyDraftLayout/);
});

test("Owner worker-day planning is Owner-authorized while resolving the worker separately", () => {
  const operatorContext = read("lib/atlas/operator-context.ts");
  const workerDayPlan = read("lib/atlas/worker-day-plan-server.ts");
  assert.match(operatorContext, /membership\.role === "owner"/);
  assert.match(operatorContext, /organizationMemberships\.some/);
  assert.match(workerDayPlan, /readAtlasOwnerOperatorContext/);
  assert.match(workerDayPlan, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(workerDayPlan, /ownerMembership/);
  assert.match(workerDayPlan, /farm_hand/);
  assert.match(workerDayPlan, /owner_worker_day_plan_choreographed_api_v1/);
});

test("the active worker-day planning RPC overloads remain Owner-only", () => {
  const migration = read("supabase/migrations/20260810181200_owner_worker_day_planning_owner_only_v2.sql");
  const choreography = read("supabase/migrations/20260811160000_atlas_day_choreography_plan_overlay_v1.sql");
  const atomicCommit = read("supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql");
  assert.match(migration, /owner_worker_day_plan_api_v1/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2/);
  assert.match(migration, /fm\.role='owner'/);
  assert.match(choreography, /owner_worker_day_plan_choreographed_api_v1/);
  assert.match(choreography, /fm\.role='owner'/);
  assert.match(atomicCommit, /fm\.role='owner'/);
  assert.match(atomicCommit, /owner_commit_worker_day_choreography_api_v1/);
});
