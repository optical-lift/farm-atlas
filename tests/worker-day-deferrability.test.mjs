import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816024500_worker_day_deferrability_v1.sql"),
  "utf8",
);

test("Worker Day deferrability reuses existing obligation and capacity truth", () => {
  assert.match(migration, /task_worker_day_deferral_v1/i);
  assert.match(migration, /task_capacity_plan_v1/i);
  assert.match(migration, /worker_day_task_placements/i);
  assert.match(migration, /task_rescheduled_by_membership_v1/i);
  assert.match(migration, /planned_work_occurrences/i);
  assert.match(migration, /clock_day_capacity_state_v2/i);
  assert.match(migration, /worker_day_available_v1/i);

  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /delete from atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.planned_work_occurrences/i);
});

test("only genuinely flexible work may be deferred by capacity", () => {
  assert.match(migration, /coalesce\(v_task\.work_lane,'discretionary'\)='discretionary'/i);
  assert.match(migration, /coalesce\(v_task\.commitment_kind,'floating'\) in \('floating','persistent'\)/i);
  assert.match(migration, /not in \('hard_window','process_continuation'\)/i);
  assert.match(migration, /not v_operationally_committed/i);
  assert.match(migration, /not v_temporal_hard/i);
  assert.match(migration, /required_over_capacity/i);
  assert.match(migration, /next_up_capacity/i);
  assert.match(migration, /next_up_recovery_capacity/i);
});

test("effective day capacity governs flexible selection and readiness stays explicit", () => {
  assert.match(migration, /v_paid_target:=greatest\(coalesce\(\(v_capacity->>'paidTargetMinutes'\)::integer,0\),0\)/i);
  assert.match(migration, /greatest\(v_paid_target-required_stats\.minutes,0\)/i);
  assert.match(migration, /waiting_on_prerequisite/i);
  assert.match(migration, /waiting_on_resource/i);
  assert.match(migration, /temporal_not_ready/i);
  assert.match(migration, /outside_lawful_window/i);
  assert.match(migration, /awaiting_favored_sky_window/i);

  // The old selector's separate recovery planning bucket must not become planned capacity again.
  assert.doesNotMatch(migration, /recovery_target_minutes/i);
  assert.doesNotMatch(migration, /recovery_room/i);
});

test("one canonical selector feeds cards and both supported Worker Day APIs", () => {
  assert.match(migration, /presented_work_selection_rows_v1/i);
  assert.match(migration, /Card projection must mirror the selector/i);
  assert.match(migration, /worker_day_selection_overlay_v1/i);
  assert.match(migration, /'nextUp',v_next/i);
  assert.match(migration, /owner_worker_day_plan_api_v1/i);
  assert.match(migration, /owner_worker_day_plan_choreographed_api_v1/i);
  assert.match(migration, /worker_self_day_plan_api_v1/i);
  assert.match(migration, /enrich_worker_day_plan_clock_capacity_v1/i);
});

test("new internal deferral helpers are not public Data API endpoints", () => {
  assert.match(
    migration,
    /revoke all on function atlas\.task_worker_day_deferral_v1\(uuid,date\) from public,anon,authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function atlas\.worker_day_selection_overlay_v1\(uuid,uuid,date,jsonb\) from public,anon,authenticated/i,
  );
  assert.match(migration, /grant execute on function atlas\.task_worker_day_deferral_v1\(uuid,date\) to service_role/i);
  assert.match(migration, /grant execute on function atlas\.worker_day_selection_overlay_v1\(uuid,uuid,date,jsonb\) to service_role/i);
});
