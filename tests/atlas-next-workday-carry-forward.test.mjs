import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("unfinished worker-day work carries to the next available workday", () => {
  const migration = read("supabase/migrations/20260809161500_carry_unfinished_work_to_next_worker_day.sql");

  assert.match(migration, /member_day_carryover_v1/);
  assert.match(migration, /extract\(isodow from p_work_date\) = 7/);
  assert.match(migration, /member_unavailability/);
  assert.match(migration, /presented_work_rows_v1\(p_farm_id, p_membership_id, v_previous_work_date\)/);
  assert.match(migration, /task_sky_presentation_gate_v1\(t.id, p_work_date\)/);
  assert.match(migration, /withheldUnderSky/);
  assert.match(migration, /task_capacity_plan_v1/);
  assert.match(migration, /personal_carry/);
});

test("future day API preserves server-authoritative carry-forward cards", () => {
  const route = read("app/api/atlas/universal-task-cards/route.ts");

  assert.match(route, /worker-day reader is authoritative for future-day membership/);
  assert.doesNotMatch(route, /filter\(\(card\) => !exactDate \|\| card\.due_date === exactDate\)/);
  assert.match(route, /readAtlasTaskDayDispositions\(doneDate\)/);
});
