import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("unfinished worker-day work carries to the next available workday", () => {
  const migration = read("supabase/migrations/20260809161500_carry_unfinished_work_to_next_worker_day.sql");
  const trustMigration = read("supabase/migrations/20260809163100_trust_internal_carryover_callers.sql");

  assert.match(migration, /member_day_carryover_v1/);
  assert.match(migration, /extract\(isodow from p_work_date\) = 7/);
  assert.match(migration, /member_unavailability/);
  assert.match(migration, /presented_work_rows_v1\(p_farm_id, p_membership_id, v_previous_work_date\)/);
  assert.match(migration, /task_sky_presentation_gate_v1\(t.id, p_work_date\)/);
  assert.match(migration, /withheldUnderSky/);
  assert.match(migration, /task_capacity_plan_v1/);
  assert.match(migration, /personal_carry/);
  assert.match(trustMigration, /revoke all on function atlas\.member_day_carryover_v1/);
  assert.match(trustMigration, /to service_role/);
});

test("carry-forward uses closed workday truth without recursively polluting later future days", () => {
  const migration = read("supabase/migrations/20260809164500_closed_workday_carry_forward_only.sql");

  assert.match(migration, /actual-state truth, not a recursive future forecast/);
  assert.match(migration, /if v_previous_work_date >= v_today then/);
  assert.match(migration, /Monday inherit unfinished Saturday work/);
  assert.match(migration, /Tuesday planning still assumes Monday's scheduled work will be completed/);
});

test("future day API preserves canonical worker-day truth while honoring explicit Owner placement", () => {
  const route = read("app/api/atlas/universal-task-cards/route.ts");

  assert.match(route, /readAtlasOperatorUniversalHome/);
  assert.match(route, /worker_day_choreography_api_v1/);
  assert.match(route, /baselineSurvivesPlacement/);
  assert.match(route, /worker_day_placed_task_cards_v1/);
  assert.match(route, /placement\.state === "placed" && placement\.serviceDate === placementDay/);
  assert.doesNotMatch(route, /filter\(\(card\) => !exactDate \|\| card\.due_date === exactDate\)/);
  assert.match(route, /readAtlasTaskDayDispositions\(doneDate\)/);
});

test("carried work consumes the same paid-day capacity as newly dated work", () => {
  const migration = read("supabase/migrations/20260809163000_count_carried_work_in_worker_day_capacity_v2.sql");

  assert.match(migration, /project_pull_options_for_member_v1/);
  assert.match(migration, /owner_build_worker_day_schedule_v1/);
  assert.match(migration, /member_day_carryover_v1\(v_membership\.farm_id,v_membership\.id,v_day\)/);
  assert.match(migration, /carriedRegularMinutes/);
  assert.match(migration, /v_current_paid := v_current_paid \+ v_carried_paid/);
  assert.match(migration, /carriedPaidMinutes/);
});
