import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const selection = read("supabase/migrations/20260814171000_worker_day_presentation_selection_core_v1.sql");
const snapshot = read("supabase/migrations/20260814172000_worker_day_plan_single_carry_snapshot_v1.sql");
const skyFastPath = read("supabase/migrations/20260814173000_worker_day_sky_withhold_fast_path_v1.sql");

test("Pass 32 separates Worker Day selection truth from rich task-card rendering", () => {
  assert.match(selection, /presented_work_selection_rows_unfiltered_v1/);
  assert.match(selection, /presented_work_selection_rows_v1/);
  assert.doesNotMatch(selection, /atlas\.v_task_cards/);
  assert.match(selection, /member_day_carryover_v1[\s\S]*presented_work_selection_rows_v1/);
  assert.match(selection, /owner_capacity_plan_v1[\s\S]*presented_work_selection_rows_unfiltered_v1/);
  assert.doesNotMatch(selection, /grant execute[\s\S]*to authenticated/i);
});

test("Pass 32 snapshots carry once per service date and reuses it for first-workday mowing", () => {
  assert.match(snapshot, /v_carry_task_ids uuid\[\]/);
  assert.match(snapshot, /v_carry_snapshot_day date/);
  assert.match(snapshot, /v_carry_snapshot_ready boolean/);
  assert.match(snapshot, /v_carry_snapshot_day:=p_day/);
  assert.match(snapshot, /from unnest\(v_carry_task_ids\) as snapshot\(task_id\)/);
  assert.match(snapshot, /v_carry_snapshot_day is distinct from v_day/);
  assert.match(snapshot, /member_day_carryover_v1\(p_farm_id,p_membership_id,v_day\)/);
  assert.match(snapshot, /expected pre-snapshot contract/);
});

test("future-day previews only reuse carry when the snapshot date actually matches", () => {
  const conditional = snapshot.indexOf("v_carry_snapshot_day is distinct from v_day");
  const fallback = snapshot.indexOf("member_day_carryover_v1(p_farm_id,p_membership_id,v_day)");
  const reuse = snapshot.lastIndexOf("from unnest(v_carry_task_ids) as snapshot(task_id)");
  assert.ok(conditional >= 0 && fallback > conditional && reuse > fallback);
});

test("sky withholding checks deferral permission before expensive full sky fitness", () => {
  const policy = skyFastPath.indexOf("task_sky_deferral_policy_v2");
  const cannotWithhold = skyFastPath.indexOf("if not coalesce((v_policy->>'canSkyWithhold')::boolean,false)");
  const fullGate = skyFastPath.indexOf("task_sky_presentation_gate_v1(v_task.id,v_day)");
  assert.ok(policy >= 0 && cannotWithhold > policy && fullGate > cannotWithhold);
  assert.match(skyFastPath, /return false;/);
  assert.match(skyFastPath, /task_sky_withheld_v1\(task.id,v_work_date\)/);
  assert.match(skyFastPath, /replace\(v_updated,v_withheld_old,'sky\.withheld'\)/);
  assert.doesNotMatch(skyFastPath, /grant execute[\s\S]*to authenticated/i);
});

test("Pass 32 leaves the rich presentation contract in place for rendered consumers", () => {
  assert.doesNotMatch(selection, /create or replace function atlas\.presented_work_rows_v1/i);
  assert.doesNotMatch(snapshot, /create or replace function atlas\.presented_work_rows_v1/i);
  assert.doesNotMatch(skyFastPath, /create or replace function atlas\.presented_work_rows_v1/i);
});
