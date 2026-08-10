import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Owner day planning is closed by default and opens from an explicit Plan today control", () => {
  const disclosure = read("components/atlas/owner-day-planning-disclosure.tsx");

  assert.match(disclosure, /useState\(false\)/);
  assert.match(disclosure, /\.atlas-owner-schedule-candidate-entry/);
  assert.match(disclosure, /\.atlas-owner-schedule-automatic-entry/);
  assert.match(disclosure, /\[data-owner-day-schedule-commit="true"\]/);
  assert.match(disclosure, /\[data-owner-schedule-synthetic-window="true"\]/);
  assert.match(disclosure, /body:not\(\[data-atlas-owner-planning-open="true"\]\)/);
  assert.match(disclosure, /display: none !important/);
  assert.match(disclosure, /aria-expanded=\{planningOpen\}/);
  assert.match(disclosure, /\+ Plan today/);
  assert.match(disclosure, /Close planning/);
});

test("Only a true Owner membership mounts the planning disclosure", () => {
  const layout = read("app/layout.tsx");

  assert.match(layout, /activeMembership\?\.role === "owner"/);
  assert.match(layout, /<OwnerDayPlanningDisclosure \/>/);
  assert.doesNotMatch(layout, /effectiveFarmRole === "owner"[^]*OwnerDayPlanningDisclosure/);
});

test("Owner planning RPC wrappers reject manager membership", () => {
  const migration = read(
    "supabase/migrations/20260810121500_owner_worker_day_planning_owner_only.sql",
  );

  assert.match(migration, /owner_worker_day_plan_api_v1/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2/);
  assert.match(migration, /fm\.role = 'owner'/);
  assert.doesNotMatch(migration, /fm\.role\s+in\s*\([^)]*manager/is);
  assert.match(migration, /Only an active owner can read worker day plans/);
  assert.match(migration, /Only an active owner can commit worker day schedules/);
});
