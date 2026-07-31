import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260731121000_harvest_watch_clock_v1.sql");
const watchRoute = read("app/api/atlas/harvest-watch/route.ts");
const cutRoute = read("app/api/atlas/harvest-cut/route.ts");
const focusRoute = read("app/task-focus/[taskId]/page.tsx");
const watchPage = read("app/task-focus/[taskId]/HarvestWatchFocusPage.tsx");
const cutPage = read("app/task-focus/[taskId]/HarvestCutFocusPage.tsx");
const manager = read("app/manage/rhythms/BiologicalRhythmManager.tsx");

test("Harvest Watch owns append-only field evidence and one current availability seam", () => {
  assert.match(migration, /create table if not exists atlas\.crop_harvest_events/);
  assert.match(migration, /create table if not exists atlas\.crop_harvest_availability/);
  assert.match(migration, /before update or delete on atlas\.crop_harvest_events/);
  assert.match(migration, /availabilityTable','crop_harvest_availability/);
  assert.match(migration, /timeClaimsPhysicalCondition',false/);
});

test("only genuinely planted active crop cycles with a harvest window enter the Clock", () => {
  assert.match(migration, /lifecycle_status='active'/);
  assert.match(migration, /coalesce\(cc\.sown_date,cc\.planted_date\) is not null/);
  assert.match(migration, /cc\.expected_harvest_watch_start is not null/);
  assert.match(migration, /go\.stable_key not like 'grow_room_%'/);
  assert.match(migration, /enroll_harvest_watch_v1/);
  assert.match(migration, /retired_for_harvest_watch_clock/);
});

test("time opens an observation but never claims readiness or an actual cut", () => {
  assert.match(migration, /physicalConditionClaimed',false/);
  assert.match(migration, /'time_claims_physical_condition',false/);
  assert.match(migration, /harvest_observed:harvestable/);
  assert.match(migration, /ensure_crop_harvest_task_v1/);
  assert.match(migration, /signal_work_occurrence_v1\(v_occurrence,'harvestable_observed'/);
  assert.match(migration, /planned_awaiting_capacity/);
  assert.match(migration, /clock_managed'\)::boolean,false\)=false/);
});

test("specialized harvest outcomes renew, release, finish, or return uncertainty", () => {
  for (const outcome of ["not_ready", "beginning", "harvestable", "declining", "finished", "problem_or_uncertain"]) {
    assert.match(migration, new RegExp(outcome));
    assert.match(watchPage, new RegExp(outcome));
  }
  assert.match(migration, /worker_open_task_problem_handoff_v1/);
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.match(watchRoute, /owner_operator_record_harvest_watch_observation_v1/);
  assert.match(watchRoute, /record_harvest_watch_observation_for_member_v1/);
});

test("harvestable observations release one canonical count task through the central gate", () => {
  assert.match(migration, /p_task_type=>'crop_harvest'/);
  assert.match(migration, /p_maximum_active_instances=>1/);
  assert.match(migration, /p_gate_type=>'event'/);
  assert.match(migration, /Harvest \+ count/);
  assert.match(migration, /task_crop_cycles/);
  assert.match(migration, /task_objects/);
});

test("actual harvest keeps marketable seconds and discarded quantities separate", () => {
  assert.match(migration, /marketable_quantity numeric/);
  assert.match(migration, /seconds_quantity numeric/);
  assert.match(migration, /discarded_quantity numeric/);
  assert.match(migration, /record_crop_harvest_cut_for_member_v1/);
  assert.match(migration, /owner_operator_record_crop_harvest_cut_v1/);
  assert.match(cutRoute, /p_marketable/);
  assert.match(cutRoute, /p_seconds/);
  assert.match(cutRoute, /p_discarded/);
  assert.match(cutPage, /More remains/);
});

test("Harvest Watch and crop cuts use focused structured result pages", () => {
  assert.match(focusRoute, /isHarvestWatchTask/);
  assert.match(focusRoute, /isCropHarvestTask/);
  assert.match(focusRoute, /HarvestWatchFocusPage/);
  assert.match(focusRoute, /HarvestCutFocusPage/);
  assert.match(watchPage, /What is physically true\?/);
  assert.match(cutPage, /What came out of the field\?/);
});

test("the Owner Rulebook includes Harvest Watch without changing the control model", () => {
  assert.match(migration, /rs\.rhythm_key in \('grow_room_care','germination_watch','harvest_watch'\)/);
  assert.match(manager, /Harvest watches/);
  assert.match(manager, /this crop’s current observation lease/);
});

test("harvest writes remain authenticated same-origin operations", () => {
  for (const route of [watchRoute, cutRoute]) {
    assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
    assert.match(route, /requireAtlasApiAccess/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  }
});
