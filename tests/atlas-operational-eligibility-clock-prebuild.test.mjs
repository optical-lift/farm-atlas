import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const eligibility = read("supabase/migrations/20260815011354_operational_eligibility_resource_temporal_v1.sql");
const garlic = read("supabase/migrations/20260815011724_garlic_deer_deterrent_method_elm_farm_fix_v1.sql");
const growRoom = read("supabase/migrations/20260815012157_rhythm_local_calendar_day_and_grow_room_daily_v1.sql");
const rhythmLane = read("supabase/migrations/20260815012244_rhythm_task_work_lane_projection_v1.sql");
const rhythmPointer = read("supabase/migrations/20260815012304_rhythm_released_occurrence_state_pointer_repair_v1.sql");
const readiness = read("supabase/migrations/20260815012658_field_transplant_readiness_compact_worker_interaction_v2.sql");
const dbContract = read("tests/sql/operational_eligibility_resource_temporal_contract.sql");
const cueDelivery = read("app/GlobalDayCueDelivery.tsx");

test("resource availability gates executability without rewriting task schedule", () => {
  assert.match(eligibility, /task_required_resources_available_v1/);
  assert.match(eligibility, /task_resource_requirements/);
  assert.match(eligibility, /required_resource_keys/);
  assert.match(eligibility, /resource\.status <> ''available''|resource\.status <> 'available'/);
  assert.match(eligibility, /owner_worker_day_plan_v1/);
  assert.match(eligibility, /owner_worker_day_plan_choreographed_v1/);
  assert.match(eligibility, /worker_day_operational_task_cards_v1/);
  assert.match(eligibility, /worker_day_operational_task_cards_v2/);
  assert.ok((eligibility.match(/task_required_resources_available_v1/g) ?? []).length >= 5);
  assert.doesNotMatch(eligibility, /set due_date\s*=\s*case[\s\S]*resource/i);
});

test("Field Rows front/back remain push-mower work and are not Cub Cadet dependencies", () => {
  assert.match(eligibility, /mowing_field_rows_front_half/);
  assert.match(eligibility, /mowing_field_rows_back_half/);
  assert.match(eligibility, /battery_push_mower/);
  assert.match(eligibility, /not in \('mowing_field_rows_front_half','mowing_field_rows_back_half'\)/);
});

test("not-before is semantic eligibility rather than a permanently blocked task", () => {
  assert.match(eligibility, /task_temporally_eligible_v1/);
  assert.match(eligibility, /temporal_gate_kind'='not_before/);
  assert.match(eligibility, /p_service_date >= \(task\.metadata->>'temporal_not_before_date'\)::date/);
  assert.match(eligibility, /Legacy waiting_until rows become explicit not-before eligibility/);
  assert.match(eligibility, /set status='open',blocker_text=null/);
});

test("rollback database contract proves reversible resource gating and time threshold", () => {
  assert.match(dbContract, /begin;/i);
  assert.match(dbContract, /rollback;/i);
  assert.match(dbContract, /needs_repair/);
  assert.match(dbContract, /status='available'/);
  assert.match(dbContract, /owner_worker_day_plan_v1/);
  assert.match(dbContract, /worker_day_operational_task_cards_v2/);
  assert.match(dbContract, /due date changed across resource toggle/i);
  assert.match(dbContract, /task_temporally_eligible_v1/);
});

test("garlic deer-deterrent method is one canonical farm method", () => {
  assert.match(garlic, /garlic_deer_deterrent_spray/);
  assert.match(garlic, /garlic_concentrate_cups',0\.75/);
  assert.match(garlic, /water_gallons',1/);
  assert.match(garlic, /Pour 3\/4 cup garlic concentrate into the pump-sprayer tank/);
  assert.match(garlic, /Add 1 gallon water/);
  assert.match(garlic, /Shake well/);
  assert.match(garlic, /daypart','evening/);
  assert.match(garlic, /no_rain_forecast/);
  assert.match(garlic, /border of every garden zone/);
  assert.match(garlic, /inside each bed/);
  assert.match(garlic, /actual sunflower leaves/);
  assert.match(garlic, /hdx_1_gallon_pump_sprayer/);
  assert.match(garlic, /garlic_deer_deterrent_concentrate/);
});

test("Grow Room daily means one local farm-calendar day, not 24 elapsed hours", () => {
  assert.match(growRoom, /local_calendar_day/);
  assert.match(growRoom, /date_trunc\('day'/);
  assert.match(growRoom, /warning_window_seconds=0/);
  assert.match(growRoom, /elm_grow_room_care_daily/);
  assert.match(growRoom, /calendarDayPolicy','one_round_per_local_farm_day/);
  assert.match(growRoom, /allow_sunday',true/);
  assert.match(growRoom, /workLane','required/);
  assert.match(growRoom, /work_window_key','morning/);
});

test("required rhythm work projects to occurrence capacity semantics", () => {
  assert.match(rhythmLane, /set work_lane = v_template ->> ''workLane''/);
  assert.match(rhythmLane, /task_payload->>''work_lane''|task_payload->>'work_lane'/);
  assert.match(rhythmLane, /signal_work_occurrence_v1/);
  assert.match(rhythmPointer, /current_task_id=occurrence\.released_task_id/);
});

test("field transplant readiness is one compact worker observation", () => {
  assert.match(readiness, /''key'',''readiness''/);
  assert.match(readiness, /''key'',''surviving_count''/);
  assert.match(readiness, /''when'',jsonb_build_object\(''key'',''readiness'',''equals'',''ready''\)/);
  assert.match(readiness, /How many seedlings are ready to plant\?/);
  assert.match(readiness, /v_count is null or v_count<1/);
  assert.match(readiness, /v_condition:=''record_number''/);
  assert.match(readiness, /sync_transplant_readiness_day_cue_v1/);
  assert.doesNotMatch(readiness.slice(readiness.indexOf("E'      jsonb_build_object(\\n        ''key'',''surviving_count''")), /''prompt'',''How did the seedlings make it\?''/);
  assert.match(cueDelivery, /question\.when|when/);
});
