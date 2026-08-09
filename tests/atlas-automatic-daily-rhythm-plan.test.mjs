import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("owner worker-day UI reads one canonical day-plan endpoint", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");
  assert.match(builder, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.doesNotMatch(builder, /Promise\.all\(/);
  assert.doesNotMatch(builder, /\/api\/atlas\/automatic-day-work\?date=/);
  assert.doesNotMatch(builder, /\/api\/atlas\/owner-day-projection\?date=/);
});

test("legacy suggestion and automatic routes are compatibility readers only", () => {
  const suggestions = read("app/api/atlas/owner-day-projection/route.ts");
  const automatic = read("app/api/atlas/automatic-day-work/route.ts");
  assert.match(suggestions, /readOwnerWorkerDayPlan/);
  assert.match(automatic, /readOwnerWorkerDayPlan/);
  assert.doesNotMatch(suggestions, /task_release_queue_items/);
  assert.doesNotMatch(automatic, /member_unavailability/);
  assert.doesNotMatch(automatic, /rhythm_state/);
});

test("automatic work is not an Owner approval selection", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");
  const commitRoute = read("app/api/atlas/owner-day-schedule/route.ts");
  assert.match(builder, /sourceKind === "project_pull" \|\| row\.sourceKind === "floating_task"/);
  assert.match(commitRoute, /"project_pull", "floating_task"/);
  assert.doesNotMatch(commitRoute, /"project_pull", "floating_task", "queue"/);
  assert.match(commitRoute, /owner_build_worker_day_schedule_api_v2/);
});

test("sowing is a hard evening rule even when stale planner metadata says otherwise", () => {
  const workOrder = read("lib/atlas/work-order.ts");
  const migration = read("supabase/migrations/20260809203600_seed_sowing_evening_hard_rule_v1.sql");
  assert.match(workOrder, /function isSeedSowing/);
  assert.match(workOrder, /if \(isSeedSowing\(task\)\) return "evening"/);
  assert.match(migration, /when lower\(coalesce\(p_action_key,''\)\) in \('sow','seed'\)/);
  assert.ok(migration.indexOf("in ('sow','seed')") < migration.indexOf("work_window_key"));
});

test("explicit Owner approval can exceed the normal capacity target without making automatic work selectable", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");
  const migration = read("supabase/migrations/20260809203300_owner_project_pull_capacity_override_v1.sql");
  assert.match(builder, /beyond the 7-hour target/);
  assert.match(migration, /pull_project_item_to_today_owner_override_v1/);
  assert.match(migration, /owner_capacity_override/);
  assert.match(migration, /overTargetMinutes/);
  assert.match(migration, /Only Owner-choice Finish Elm or floating work may be committed/);
});

test("worker day plan contract isolates real automatic and suggested work", () => {
  const reader = read("lib/atlas/worker-day-plan-server.ts");
  assert.match(reader, /realWork: WorkerDayPlanRow\[\]/);
  assert.match(reader, /automaticWork: WorkerDayPlanRow\[\]/);
  assert.match(reader, /suggestions: WorkerDayPlanRow\[\]/);
  assert.match(reader, /warnings: string\[\]/);
});
