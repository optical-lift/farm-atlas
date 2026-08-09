import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capacityMigration = readFileSync(
  new URL("../supabase/migrations/20260809013600_full_paid_day_capacity_contract.sql", import.meta.url),
  "utf8",
);
const projectionMigration = readFileSync(
  new URL("../supabase/migrations/20260809013700_fill_owner_week_projection_to_paid_capacity.sql", import.meta.url),
  "utf8",
);
const personalMigration = readFileSync(
  new URL("../supabase/migrations/20260809013800_mark_personal_tasks_in_day_presentation.sql", import.meta.url),
  "utf8",
);
const projectionReader = readFileSync(
  new URL("../lib/atlas-data/owner-week-projection.ts", import.meta.url),
  "utf8",
);
const projectionRoute = readFileSync(
  new URL("../app/api/atlas/owner-day-projection/route.ts", import.meta.url),
  "utf8",
);
const projectionUi = readFileSync(
  new URL("../components/atlas/owner-tentative-day-projection.tsx", import.meta.url),
  "utf8",
);

test("Anna retains a full paid-work target regardless of prior completion", () => {
  assert.match(capacityMigration, /regular_target_minutes = 420/);
  assert.match(capacityMigration, /maximum_planned_minutes = 480/);
  assert.match(capacityMigration, /completion_history_may_reduce_target', false/);
  assert.match(capacityMigration, /paid_active_target_minutes', 420/);
  assert.doesNotMatch(capacityMigration, /six[_ -]?unit/i);
});

test("personal obligations and micro observations remain visible without filling paid capacity", () => {
  assert.match(capacityMigration, /School and Preschool Enrollment/);
  assert.match(capacityMigration, /Grey Couch in Garage/);
  assert.match(capacityMigration, /personal_noncounting/);
  assert.match(capacityMigration, /micro_round_key = 'grow_room_observation'/);
  assert.match(capacityMigration, /expected_active_minutes := 0/);
  assert.match(personalMigration, /'display_family', 'Personal'/);
});

test("small Follow Me mowing is owner-calibrated instead of treated as a heavy hour", () => {
  assert.match(capacityMigration, /Mowing — Follow Me Paths \+ Edges/);
  assert.match(capacityMigration, /20, 'light', 'routine_production'/);
  assert.match(capacityMigration, /owner_calibrated:follow_me_mowing/);
});

test("owner projection keeps selecting compatible project work until paid capacity is filled", () => {
  assert.match(projectionMigration, /v_remaining := greatest\(v_target_minutes - v_paid_minutes, 0\)/);
  assert.match(projectionMigration, /for v_iteration in 1\.\.12 loop/);
  assert.match(projectionMigration, /exit when v_remaining <= 0/);
  assert.match(projectionMigration, /v_remaining := greatest\(v_remaining - v_option_minutes, 0\)/);
  assert.match(projectionMigration, /preferred_membership_id/);
  assert.doesNotMatch(projectionMigration, /six[_ -]?unit/i);
});

test("Owner operating as Anna can see the paid-day fill, not just a thin task count", () => {
  assert.match(projectionReader, /paidTargetMinutes/);
  assert.match(projectionRoute, /scheduledPaidMinutes/);
  assert.match(projectionRoute, /tentativePaidMinutes/);
  assert.match(projectionRoute, /projectedPaidMinutes/);
  assert.match(projectionRoute, /paidGapMinutes/);
  assert.match(projectionUi, /paid work projected/);
  assert.match(projectionUi, /is already scheduled paid Elm work/);
  assert.match(projectionUi, /proposed below to fill the workday/);
  assert.match(projectionUi, /Day filled/);
});
