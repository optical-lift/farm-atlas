import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner worker-day planning resolves one Farm Hand directly or through an explicit worker lens", () => {
  const route = read("app/api/atlas/worker-day-plan/route.ts");
  const reader = read("lib/atlas/worker-day-plan-server.ts");

  assert.match(route, /getAtlasSession/);
  assert.match(route, /readOwnerWorkerDayPlan/);
  assert.match(reader, /readAtlasOwnerOperatorContext/);
  assert.match(reader, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(reader, /source: "operator_lens"/);
  assert.match(reader, /source: "owner_direct"/);
  assert.match(reader, /workers\.length !== 1/);
  assert.match(reader, /owner_worker_day_plan_choreographed_api_v1/);
  assert.match(reader, /realWork/);
  assert.match(reader, /automaticWork/);
  assert.match(reader, /suggestions/);
  assert.doesNotMatch(reader, /task_release_queue_items|member_unavailability|rhythm_state/);
  assert.doesNotMatch(reader, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Owner Day Edit remains one deliberate purple choreography mode with one atomic commit", () => {
  const component = read("components/atlas/owner-day-schedule-builder.tsx");
  const gate = read("components/atlas/owner-day-plan-gate.tsx");
  const daySummary = read("components/atlas/day-trail-summary.tsx");
  const layout = read("app/layout.tsx");
  const commitRoute = read("app/api/atlas/owner-day-commit/route.ts");
  const postRoute = read("app/api/atlas/owner-day-schedule/route.ts");
  const editRoute = read("app/api/atlas/owner-day-edit/route.ts");

  assert.match(component, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.match(component, /\/api\/atlas\/day-choreography\?date=/);
  assert.match(component, /\/api\/atlas\/owner-day-commit/);
  assert.match(component, /owner-day-commit-v1/);
  assert.doesNotMatch(component, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(component, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.match(component, /data-owner-day-edit-board/);
  assert.match(component, /Work/);
  assert.match(component, /Cues/);
  assert.match(component, /Both/);
  assert.match(component, /Return to Atlas/);
  assert.match(component, /draggable/);
  assert.match(component, /Commit \$\{dirtyCount\} change/);
  assert.match(component, /aria-pressed/);
  assert.match(component, /window\.location\.reload/);
  assert.doesNotMatch(component, /createPortal/);
  assert.doesNotMatch(component, /MutationObserver/);

  assert.match(gate, /Edit today/);
  assert.match(gate, /setOpen\(true\)/);
  assert.match(gate, /setOpen\(false\)/);
  assert.match(gate, /open \? \(/);
  assert.match(gate, /<OwnerDayScheduleBuilder \/>/);
  assert.match(gate, /<OwnerDayCueEditor \/>/);
  assert.match(gate, /working Day changes only when you commit it/);
  assert.doesNotMatch(daySummary, /OwnerDayScheduleBuilder/);
  assert.doesNotMatch(layout, /OwnerDayPlanGate/);

  assert.match(commitRoute, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(commitRoute, /resolveOwnerWorkerDayPlanningTarget/);
  assert.match(commitRoute, /owner-day-commit-v1/);
  assert.match(commitRoute, /"project_pull", "floating_task"/);

  assert.match(postRoute, /owner_build_worker_day_schedule_api_v2/);
  assert.match(postRoute, /owner-day-schedule-v1/);
  assert.match(editRoute, /owner_apply_worker_day_edits_api_v1/);
  assert.match(editRoute, /return_to_atlas/);
  assert.match(editRoute, /rewindow/);
  assert.match(editRoute, /reschedule/);
  assert.match(editRoute, /reorder/);
});

test("legacy day-planning endpoints are compatibility shells around the canonical resolver", () => {
  const suggestions = read("app/api/atlas/owner-day-projection/route.ts");
  const automatic = read("app/api/atlas/automatic-day-work/route.ts");

  assert.match(suggestions, /readOwnerWorkerDayPlan/);
  assert.match(automatic, /readOwnerWorkerDayPlan/);
  assert.doesNotMatch(suggestions, /project_pull_options_for_member_v2|anna_weeding_rotation/);
  assert.doesNotMatch(automatic, /member_unavailability|task_release_queue_items|rhythm_state/);
});

test("the duplicate Possible Work bridge is retired instead of mounted as a no-op", () => {
  const bridgeUrl = new URL("../app/FutureDayProjectionBridge.tsx", import.meta.url);
  const layout = read("app/layout.tsx");
  assert.equal(existsSync(bridgeUrl), false);
  assert.doesNotMatch(layout, /FutureDayProjectionBridge/);
});

test("Owner approval applies only to discretionary purple work; Weed and Mow remain automatic", () => {
  const planMigration = read("supabase/migrations/20260809203000_owner_worker_day_plan_kernel_v1.sql");
  const commitMigration = read("supabase/migrations/20260809203100_owner_worker_day_schedule_commit_v2.sql");

  assert.match(planMigration, /anna_weeding_rotation/);
  assert.match(planMigration, /One Weed Card owns each workday/);
  assert.match(planMigration, /One mowing area is reserved for each workday/);
  assert.match(planMigration, /requiresOwnerApproval',false/);
  assert.match(planMigration, /requiresOwnerApproval',true/);
  assert.match(commitMigration, /Only Owner-choice Finish Elm or floating work may be committed/);
  assert.match(commitMigration, /owner_build_worker_day_schedule_api_v2/);
  assert.doesNotMatch(commitMigration, /v_kind='queue'/);
});

test("weekly project ranking still uses the capacity-aware option engine", () => {
  const migration = read("supabase/migrations/20260808192000_make_owner_week_projection_capacity_aware.sql");

  assert.match(migration, /project_pull_options_for_member_v2/);
  assert.match(migration, /fitsToday/);
  assert.match(migration, /with ordinality/);
  assert.match(migration, /Project work fitted into projected daily capacity/);
  assert.doesNotMatch(migration, /v_daily_minutes/);
});
