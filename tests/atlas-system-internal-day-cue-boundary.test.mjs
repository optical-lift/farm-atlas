import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260815000421_worker_day_system_internal_visibility_boundary_v1.sql");
const taskFocus = read("app/task-focus/[taskId]/page.tsx");
const cueDelivery = read("app/GlobalDayCueDelivery.tsx");
const cueResponseRoute = read("app/api/atlas/day-cue-response/route.ts");
const pass38 = read("tests/atlas-worker-day-unified-pass38.test.mjs");

test("system_internal tasks are state sources, not Worker Day cards", () => {
  assert.match(migration, /system_internal tasks are state sources, not Worker Day cards/);
  assert.match(migration, /owner_worker_day_plan_v1/);
  assert.match(migration, /t\.due_date=p_day[\s\S]*coalesce\(t\.visibility_scope/);
  assert.match(migration, /task_capacity_plan_v1\(t,p_day\)[\s\S]*coalesce\(t\.visibility_scope/);
  assert.match(migration, /owner_worker_day_plan_choreographed_v1/);
  assert.match(migration, /coalesce\(task\.visibility_scope/);
  assert.match(migration, /worker_day_operational_task_cards_v1/);
  assert.match(migration, /worker_day_operational_task_cards_v2/);
  assert.ok((migration.match(/<> ''system_internal''/g) ?? []).length >= 4);
});

test("explicit choreography placement cannot override system_internal visibility", () => {
  const choreographedPatch = migration.slice(migration.indexOf("owner_worker_day_plan_choreographed_v1"));
  assert.match(choreographedPatch, /task\.status = ''open''[\s\S]*coalesce\(task\.visibility_scope/);
});

test("operational card hydration fails closed for system_internal task ids", () => {
  const v1 = migration.slice(migration.indexOf("worker_day_operational_task_cards_v1"));
  const v2 = migration.slice(migration.indexOf("worker_day_operational_task_cards_v2"));
  assert.match(v1, /task\.id = any\(p_task_ids\)[\s\S]*coalesce\(task\.visibility_scope/);
  assert.match(v2, /task\.id = any\(v_ids\)[\s\S]*coalesce\(task\.visibility_scope/);
});

test("day-cue-backed internal tasks cannot render the ordinary Task Focus surface", () => {
  assert.match(taskFocus, /visibility_scope: string \| null/);
  assert.match(taskFocus, /select\("id, farm_id, title, task_type, task_scope, due_date, visibility_scope, metadata"\)/);
  assert.match(taskFocus, /task\.visibility_scope === "system_internal"/);
  assert.match(taskFocus, /observation_delivery_mode/);
  assert.match(taskFocus, /=== "day_cue"/);
  assert.match(taskFocus, /if \(task && isDayCueStateSource\(task\)\) notFound\(\)/);
});

test("the existing Day cue response path remains the worker-facing interaction", () => {
  assert.match(cueDelivery, /\/api\/atlas\/day-cue-response/);
  assert.match(cueResponseRoute, /worker_resolve_day_cue_api_v1/);
  assert.doesNotMatch(taskFocus, /apply_worker_day_field_transplant_readiness_v1/);
});

test("Pass 38 stays the one Farm Hand Worker Day projection path", () => {
  assert.match(pass38, /Farm Hand self planner delegates to canonical Worker Day truth/);
  assert.match(pass38, /one Worker Day endpoint serves Owner-managed and Farm Hand self projections/);
  assert.match(pass38, /Farm Hand plan-card bundle and target-scoped choreography run concurrently/);
});
