import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816015500_day_aware_human_capacity_v1.sql"),
  "utf8",
);

test("day-aware capacity extends existing Worker Day authorities", () => {
  for (const existingAuthority of [
    "member_capacity_settings",
    "member_unavailability",
    "day_reservations",
    "worker_day_task_placements",
    "task_capacity_plan_v1",
  ]) {
    assert.match(migration, new RegExp(existingAuthority));
  }

  assert.match(migration, /unavailable_local_start time without time zone/i);
  assert.match(migration, /unavailable_local_end time without time zone/i);
  assert.match(migration, /partial-day unavailability/i);
  assert.match(migration, /worker_day_available_v1/i);
  assert.match(migration, /member_day_capacity_blocks_v1/i);
  assert.match(migration, /range_agg\(tstzrange/i);
});

test("capacity reports fixed-time, heavy-work, and interval conflicts without erasing obligations", () => {
  assert.match(migration, /clock_day_capacity_state_v2/i);
  assert.match(migration, /configuredPaidTargetMinutes/i);
  assert.match(migration, /configuredMaximumPlannedMinutes/i);
  assert.match(migration, /day_capacity_reduced_by_reservations/i);
  assert.match(migration, /day_capacity_reduced_by_partial_unavailability/i);
  assert.match(migration, /day_capacity_heavy_soft_cap_exceeded/i);
  assert.match(migration, /clock_task_interval_overlap/i);
  assert.match(migration, /clock_interval_overlaps_reservation/i);
  assert.match(migration, /clock_interval_overlaps_unavailability/i);
  assert.match(migration, /Capacity is an arbitration\/read contract only/i);
  assert.match(migration, /never erase, suppress, or[\s\S]*rewrite upstream obligations/i);

  assert.doesNotMatch(migration, /delete from atlas\.planned_work_occurrences/i);
  assert.doesNotMatch(migration, /delete from atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.planned_work_occurrences/i);
  assert.doesNotMatch(migration, /update atlas\.tasks/i);
});

test("existing Worker Day projection seam consumes v2 capacity without a second client API", () => {
  assert.match(migration, /create or replace function atlas\.enrich_worker_day_plan_clock_capacity_v1/i);
  assert.match(migration, /atlas\.clock_day_capacity_state_v2\(p_farm_id, p_membership_id, p_day, v_planned, v_heavy\)/i);
  assert.match(migration, /v_capacity->'conflictCodes'/i);
  assert.match(migration, /'clockCapacity', v_capacity/i);
  assert.match(migration, /'remainingPaidMinutes', greatest\(v_target - v_planned, 0\)/i);
});

test("new internal capacity helpers are not public Data API endpoints", () => {
  assert.match(
    migration,
    /revoke all on function atlas\.member_day_capacity_blocks_v1\(uuid,uuid,date\) from public, anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on function atlas\.clock_day_capacity_state_v2\(uuid,uuid,date,integer,integer\) from public, anon, authenticated/i,
  );
  assert.match(migration, /grant execute on function atlas\.member_day_capacity_blocks_v1\(uuid,uuid,date\) to service_role/i);
  assert.match(migration, /grant execute on function atlas\.clock_day_capacity_state_v2\(uuid,uuid,date,integer,integer\) to service_role/i);
});
