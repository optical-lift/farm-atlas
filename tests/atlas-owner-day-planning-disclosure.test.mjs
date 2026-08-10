import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), "utf8");

test("owner day planner stays hidden until the Owner opens Plan today", () => {
  const gate = read("components/atlas/owner-day-plan-gate.tsx");

  assert.match(gate, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.match(gate, /Plan today/);
  assert.match(gate, /Nothing enters the working day until you commit it\./);
  assert.match(gate, /\{open \? <OwnerDayScheduleBuilder \/> : null\}/);
  assert.match(gate, /onClick=\{\(\) => setOpen\(false\)\}/);
});

test("schedule suggestions remain local until explicit commit", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");

  assert.match(builder, /useState<Set<string>>\(new Set\(\)\)/);
  assert.match(builder, /selectedCandidates\.map\(\(candidate\) => \(\{ sourceKind: candidate\.sourceKind, sourceId: candidate\.sourceId \}\)\)/);
  assert.match(builder, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.match(builder, /method: "POST"/);
  assert.match(builder, /window\.location\.reload\(\)/);
});

test("operator context is Owner-only at the application layer", () => {
  const operatorContext = read("lib/atlas/operator-context.ts");

  assert.match(operatorContext, /hasOwnerAccess\(ownerIdentity\.access\)/);
  assert.match(operatorContext, /operatingMembership\.role !== "farm_hand"/);
  assert.match(operatorContext, /operatorRole: "Owner"/);
});

test("worker-day planning RPC wrappers are Owner-only at the database layer", () => {
  const migration = read("supabase/migrations/20260810124500_owner_worker_day_planning_owner_only_v1.sql");

  assert.match(migration, /owner_worker_day_plan_api_v1\([\s\S]*p_membership_id uuid/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2\([\s\S]*p_membership_id uuid/);
  assert.match(migration, /fm\.role = 'owner'/);
  assert.doesNotMatch(migration, /fm\.role in \('owner', 'manager'\)/);
  assert.match(migration, /Owner access required/);
});
