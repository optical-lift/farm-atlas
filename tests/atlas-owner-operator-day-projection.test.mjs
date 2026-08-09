import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner schedule candidate discovery resolves the selected Farm Hand on the server", () => {
  const route = read("app/api/atlas/owner-day-projection/route.ts");

  assert.match(route, /getAtlasSession/);
  assert.match(route, /readAtlasOwnerOperatorContext/);
  assert.match(route, /effectiveOperatorMembershipId/);
  assert.match(route, /effective\.farmRole !== "farm_hand"/);
  assert.match(route, /project_pull_options_for_member_v2/);
  assert.match(route, /floating_paid_work_candidates_v1/);
  assert.match(route, /anna_weeding_rotation/);
  assert.match(route, /candidates/);
  assert.doesNotMatch(route, /searchParams\.get\(["']membership/i);
  assert.doesNotMatch(route, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Owner schedule builder makes tentative work real only after explicit approval", () => {
  const component = read("components/atlas/owner-day-schedule-builder.tsx");
  const daySummary = read("components/atlas/day-trail-summary.tsx");
  const postRoute = read("app/api/atlas/owner-day-schedule/route.ts");

  assert.match(component, /\/api\/atlas\/owner-day-projection\?date=/);
  assert.match(component, /\/api\/atlas\/owner-day-schedule/);
  assert.match(component, /x-atlas-intent/);
  assert.match(component, /owner-day-schedule-v1/);
  assert.match(component, /Owner schedule builder/);
  assert.match(component, /Build \{operatorLabel\}&apos;s day/);
  assert.match(component, /aria-pressed/);
  assert.match(component, /Nothing below becomes/);
  assert.match(component, /A Weed Card stays behind the card ahead of it/);
  assert.match(component, /Build \$\{operatorLabel\}'s schedule/);
  assert.match(component, /<button/);

  assert.match(daySummary, /OwnerDayScheduleBuilder/);
  assert.match(daySummary, /compact \? <OwnerDayScheduleBuilder \/>/);

  assert.match(postRoute, /owner_build_worker_day_schedule_v1/);
  assert.match(postRoute, /effective\.farmRole !== "farm_hand"/);
  assert.match(postRoute, /owner-day-schedule-v1/);
});

test("the duplicate Possible Work bridge is disabled", () => {
  const bridge = read("app/FutureDayProjectionBridge.tsx");
  assert.match(bridge, /return null/);
  assert.doesNotMatch(bridge, /Possible work|Projected Finish Elm|Projected Weed Card/);
});

test("Owner approval gates Finish Elm and serial Weed Card release", () => {
  const builderMigration = read("supabase/migrations/20260809150556_owner_approved_worker_day_builder.sql");
  const capacityMigration = read("supabase/migrations/20260809150824_owner_day_builder_counts_approved_queue.sql");
  const queueMigration = read("supabase/migrations/20260809151400_anna_weeding_owner_schedule_gate_default.sql");

  assert.match(builderMigration, /owner_schedule_approval_required/);
  assert.match(builderMigration, /farm_hand_assigned_work_continues', false/);
  assert.match(capacityMigration, /owner_build_worker_day_schedule_v1/);
  assert.match(capacityMigration, /approvedConditionalMinutes/);
  assert.match(capacityMigration, /pull_project_item_to_today_v1/);
  assert.match(queueMigration, /p_queue_key='anna_weeding_rotation'/);
  assert.match(queueMigration, /owner_schedule_approved_date/);
  assert.match(queueMigration, /awaiting_owner_schedule_approval/);
});

test("weekly project ranking still uses the capacity-aware option engine", () => {
  const migration = read("supabase/migrations/20260808192000_make_owner_week_projection_capacity_aware.sql");

  assert.match(migration, /project_pull_options_for_member_v2/);
  assert.match(migration, /fitsToday/);
  assert.match(migration, /with ordinality/);
  assert.match(migration, /Project work fitted into projected daily capacity/);
  assert.doesNotMatch(migration, /v_daily_minutes/);
});
