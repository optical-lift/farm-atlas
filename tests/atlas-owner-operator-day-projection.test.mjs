import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner worker-day planning resolves the selected Farm Hand through one guarded plan reader", () => {
  const route = read("app/api/atlas/worker-day-plan/route.ts");
  const reader = read("lib/atlas/worker-day-plan-server.ts");

  assert.match(route, /getAtlasSession/);
  assert.match(route, /readOwnerWorkerDayPlan/);
  assert.match(reader, /readAtlasOwnerOperatorContext/);
  assert.match(reader, /effectiveOperatorMembershipId/);
  assert.match(reader, /effective\.farmRole !== "farm_hand"/);
  assert.match(reader, /owner_worker_day_plan_api_v1/);
  assert.match(reader, /realWork/);
  assert.match(reader, /automaticWork/);
  assert.match(reader, /suggestions/);
  assert.doesNotMatch(reader, /task_release_queue_items|member_unavailability|rhythm_state/);
  assert.doesNotMatch(reader, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Owner schedule ideas stay behind the Plan today gate until explicitly opened", () => {
  const component = read("components/atlas/owner-day-schedule-builder.tsx");
  const gate = read("components/atlas/owner-day-plan-gate.tsx");
  const daySummary = read("components/atlas/day-trail-summary.tsx");
  const layout = read("app/layout.tsx");
  const postRoute = read("app/api/atlas/owner-day-schedule/route.ts");

  assert.match(component, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.match(component, /\/api\/atlas\/owner-day-schedule/);
  assert.match(component, /x-atlas-intent/);
  assert.match(component, /owner-day-schedule-v1/);
  assert.match(component, /createPortal/);
  assert.match(component, /\.atlas-day-mixed-timeline/);
  assert.match(component, /data-owner-schedule-candidate/);
  assert.match(component, /CandidateRow/);
  assert.match(component, /plan\?\.realWork/);
  assert.match(component, /workOrderNumber/);
  assert.match(component, /dayWindow/);
  assert.match(component, /data-owner-day-schedule-commit/);
  assert.match(component, /Commit schedule/);
  assert.match(component, /Purple cards are suggestions/);
  assert.match(component, /aria-pressed/);
  assert.match(component, /window\.location\.reload/);

  assert.match(gate, /Plan today/);
  assert.match(gate, /setOpen\(true\)/);
  assert.match(gate, /setOpen\(false\)/);
  assert.match(gate, /open \? <OwnerDayScheduleBuilder \/> : null/);
  assert.match(gate, /Nothing enters the working day until you commit it/);
  assert.doesNotMatch(daySummary, /OwnerDayScheduleBuilder/);
  assert.match(layout, /OwnerDayPlanGate/);

  assert.match(postRoute, /owner_build_worker_day_schedule_api_v2/);
  assert.match(postRoute, /effective\.farmRole !== "farm_hand"/);
  assert.match(postRoute, /owner-day-schedule-v1/);
  assert.match(postRoute, /"project_pull", "floating_task"/);
  assert.doesNotMatch(postRoute, /"project_pull", "floating_task", "queue"/);
});

test("legacy day-planning endpoints are compatibility shells around the canonical resolver", () => {
  const suggestions = read("app/api/atlas/owner-day-projection/route.ts");
  const automatic = read("app/api/atlas/automatic-day-work/route.ts");

  assert.match(suggestions, /readOwnerWorkerDayPlan/);
  assert.match(automatic, /readOwnerWorkerDayPlan/);
  assert.doesNotMatch(suggestions, /project_pull_options_for_member_v2|anna_weeding_rotation/);
  assert.doesNotMatch(automatic, /member_unavailability|task_release_queue_items|rhythm_state/);
});

test("the duplicate Possible Work bridge is disabled", () => {
  const bridge = read("app/FutureDayProjectionBridge.tsx");
  assert.match(bridge, /return null/);
  assert.doesNotMatch(bridge, /Possible work|Projected Finish Elm|Projected Weed Card/);
});

test("Owner approval applies only to discretionary purple work; Weed and Mow are automatic", () => {
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
