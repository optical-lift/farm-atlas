import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), "utf8");

test("Owner Day choreography stays hidden until the Owner opens Edit today", () => {
  const gate = read("components/atlas/owner-day-plan-gate.tsx");

  assert.match(gate, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.match(gate, /Edit today/);
  assert.match(gate, /Purple is a draft/);
  assert.match(gate, /\{open \? \(/);
  assert.match(gate, /<OwnerDayScheduleBuilder \/>/);
  assert.match(gate, /<OwnerDayCueEditor \/>/);
  assert.match(gate, /onClick=\{\(\) => setOpen\(false\)\}/);
  assert.match(gate, /data-owner-day-starting-load="true"/);
});

test("Owner Edit today reveals the starting paid-load budget without changing the worker Day", () => {
  const gate = read("components/atlas/owner-day-plan-gate.tsx");

  assert.match(gate, /paidTargetMinutes\?: number/);
  assert.match(gate, /committedPaidMinutes\?: number/);
  assert.match(gate, /automaticPaidMinutes\?: number/);
  assert.match(gate, /const knownLoadMinutes = Math\.max\(0, Number\(probe\?\.plan\?\.committedPaidMinutes\) \|\| 0\)/);
  assert.match(gate, /\+ Math\.max\(0, Number\(probe\?\.plan\?\.automaticPaidMinutes\) \|\| 0\)/);
  assert.match(gate, /const overByMinutes = Math\.max\(knownLoadMinutes - targetMinutes, 0\)/);
  assert.match(gate, /Starting load · \{minutesLabel\(knownLoadMinutes\)\} \/ \{minutesLabel\(targetMinutes\)\} target/);
  assert.match(gate, /data-over-capacity=\{overByMinutes \? "true" : "false"\}/);
  assert.doesNotMatch(gate, /fetch\([^\n]+method:\s*"POST"/);
});

test("purple additions and Owner Day changes remain drafts until one explicit atomic commit", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");

  assert.match(builder, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(builder, /selections:\s*selectedCandidates\.map\(\(candidate\) => \(\{[\s\S]*sourceKind: candidate\.sourceKind,[\s\S]*sourceId: candidate\.sourceId,[\s\S]*\}\)\)/);
  assert.match(builder, /fetch\("\/api\/atlas\/owner-day-commit"/);
  assert.match(builder, /owner-day-commit-v1/);
  assert.doesNotMatch(builder, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(builder, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.match(builder, /return_to_atlas/);
  assert.match(builder, /method: "POST"/);
  assert.match(builder, /window\.location\.reload\(\)/);
});

test("Owner worker-day planning is Owner-authorized while resolving the worker separately", () => {
  const operatorContext = read("lib/atlas/operator-context.ts");
  const workerDayPlan = read("lib/atlas/worker-day-plan-server.ts");

  assert.match(operatorContext, /membership\.role === "owner"/);
  assert.match(operatorContext, /organizationMemberships\.some\(\(membership\) => membership\.role === "owner"\)/);
  assert.match(workerDayPlan, /readAtlasOwnerOperatorContext\(\)/);
  assert.match(workerDayPlan, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(workerDayPlan, /ownerMembership/);
  assert.match(workerDayPlan, /\.eq\("role", "farm_hand"\)/);
  assert.match(workerDayPlan, /owner_worker_day_plan_choreographed_api_v1/);
});

test("the active worker-day planning RPC overloads remain Owner-only", () => {
  const migration = read("supabase/migrations/20260810181200_owner_worker_day_planning_owner_only_v2.sql");
  const choreography = read("supabase/migrations/20260811160000_atlas_day_choreography_plan_overlay_v1.sql");
  const atomicCommit = read("supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql");

  assert.match(migration, /owner_worker_day_plan_api_v1\(\s*p_farm_id uuid,\s*p_membership_id uuid,\s*p_day date\s*\)/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2\(\s*p_farm_id uuid,\s*p_membership_id uuid,\s*p_day date,\s*p_selections jsonb\s*\)/);
  assert.match(migration, /fm\.role='owner'/);
  assert.doesNotMatch(migration, /fm\.role\s+in\s*\(\s*'owner'\s*,\s*'manager'\s*\)/i);
  assert.match(choreography, /owner_worker_day_plan_choreographed_api_v1/);
  assert.match(choreography, /fm\.role='owner'/);
  assert.match(atomicCommit, /fm\.role='owner'/);
  assert.match(atomicCommit, /owner_commit_worker_day_choreography_api_v1/);
});
