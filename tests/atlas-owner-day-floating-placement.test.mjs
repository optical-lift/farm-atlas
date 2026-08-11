import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811225500_owner_day_floating_work_placement_v1.sql", import.meta.url),
  "utf8",
);
const choreography = readFileSync(
  new URL("../supabase/migrations/20260811160000_atlas_day_choreography_plan_overlay_v1.sql", import.meta.url),
  "utf8",
);
const atomic = readFileSync(
  new URL("../supabase/migrations/20260811223000_atlas_owner_day_atomic_commit_v1.sql", import.meta.url),
  "utf8",
);

test("Owner-selected floating work uses the canonical Day placement writer instead of gaining a due date", () => {
  assert.match(migration, /elsif v_kind='floating_task'/);
  assert.match(migration, /owner_apply_worker_day_edits_api_v1/);
  assert.match(migration, /'kind','place'/);
  assert.match(migration, /'serviceDate',p_day/);
  assert.match(migration, /worker_task_day_window_v1/);
  assert.match(migration, /worker_task_order_v1/);
  assert.doesNotMatch(migration, /set\s+due_date\s*=\s*p_day/i);
  assert.doesNotMatch(migration, /owner_schedule_approved_date',p_day/);
});

test("floating work is revalidated under the schedule lock before placement", () => {
  const lockIndex = migration.indexOf("pg_advisory_xact_lock");
  const secondLoopIndex = migration.indexOf("for v_selection", lockIndex);
  const revalidationIndex = migration.indexOf("floating_paid_work_candidates_v1", secondLoopIndex);
  const placementIndex = migration.indexOf("owner_apply_worker_day_edits_api_v1", revalidationIndex);
  assert.ok(lockIndex >= 0);
  assert.ok(secondLoopIndex > lockIndex);
  assert.ok(revalidationIndex > secondLoopIndex);
  assert.ok(placementIndex > revalidationIndex);
  assert.match(migration, /changed before the schedule could be built/);
});

test("the choreographed Day reader already knows how to render explicit placements without canonical due-date mutation", () => {
  assert.match(choreography, /explicit Owner Day placement/);
  assert.match(choreography, /without rewriting canonical task due dates/);
  assert.match(choreography, /from atlas\.worker_day_task_placements placement/);
  assert.match(choreography, /placement\.service_date=p_day/);
  assert.match(choreography, /v_real:=v_real\|\|v_placed/);
});

test("the purple atomic commit still wraps placement edits and selected work in one database transaction", () => {
  assert.match(atomic, /owner_apply_worker_day_edits_api_v1/);
  assert.match(atomic, /owner_build_worker_day_schedule_api_v2/);
  assert.match(atomic, /pg_advisory_xact_lock/);
});

test("legacy Owner-Day dates are retired only for tasks already declared floating eligibility", () => {
  assert.match(migration, /set due_date=null/);
  assert.match(migration, /task\.commitment_kind='floating'/);
  assert.match(migration, /task\.work_lane='discretionary'/);
  assert.match(migration, /task\.sky_deferral_mode='allow'/);
  assert.match(migration, /task\.metadata->>'schedule_semantics'='floating_eligibility'/);
  assert.match(migration, /task\.metadata \? 'legacy_due_date_retired_on'/);
  assert.match(migration, /legacy_owner_day_due_retired_from/);
  assert.match(migration, /placement is presentation choreography and must not become canonical task due truth/);
  assert.doesNotMatch(migration, /6e44f4a6-a0f1-4061-b1c5-f63b1a233580/);
});
