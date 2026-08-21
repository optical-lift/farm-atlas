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
const weekly = read("components/atlas/weekly-harvest-task-detail.tsx");
const unify = read("supabase/migrations/20260821161000_unify_weekly_harvest_card_v1.sql");
const manager = read("app/manage/rhythms/BiologicalRhythmManager.tsx");

test("Harvest Watch keeps append-only field evidence and one current availability seam", () => {
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

test("specialized Harvest Watch observation outcomes remain backend evidence, not worker-facing Harvest choices", () => {
  for (const outcome of ["not_ready", "beginning", "harvestable", "declining", "finished", "problem_or_uncertain"]) {
    assert.match(migration, new RegExp(outcome));
  }
  assert.match(migration, /worker_open_task_problem_handoff_v1/);
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.match(watchRoute, /owner_operator_record_harvest_watch_observation_v1/);
  assert.match(watchRoute, /record_harvest_watch_observation_for_member_v1/);

  assert.match(weekly, /not_ready/);
  assert.match(weekly, /deadheaded/);
  assert.match(weekly, /crop_exhausted/);
  assert.doesNotMatch(weekly, /value:\s*"beginning"|value:\s*"harvestable"|value:\s*"declining"|value:\s*"finished"|value:\s*"problem_or_uncertain"/);
});

test("harvestable observations still preserve their canonical backend release lineage", () => {
  assert.match(migration, /p_task_type=>'crop_harvest'/);
  assert.match(migration, /p_maximum_active_instances=>1/);
  assert.match(migration, /p_gate_type=>'event'/);
  assert.match(migration, /Harvest \+ count/);
  assert.match(migration, /task_crop_cycles/);
  assert.match(migration, /task_objects/);
});

test("legacy flower-harvest endpoints remain authenticated evidence boundaries while the weekly card owns worker recording", () => {
  assert.match(cutRoute, /BUCKET_BANDS/);
  assert.match(cutRoute, /p_bucket_band/);
  assert.match(cutRoute, /owner_operator_record_flower_harvest_output_v1/);
  assert.match(cutRoute, /record_flower_harvest_output_for_member_v1/);
  assert.doesNotMatch(cutRoute, /p_marketable|p_seconds|p_discarded/);

  assert.match(unify, /standalone_harvest_tasks_forbidden/);
  assert.match(unify, /weeklyHarvestCardIsOnlyWorkerCarrier/);
  assert.match(weekly, /\/api\/atlas\/weekly-harvest/);
});

test("standalone Harvest Watch and crop-cut Task Focus displays are retired", () => {
  assert.match(focusRoute, /function isLegacyStandaloneHarvestTask/);
  assert.match(focusRoute, /isDayCueStateSource\(task\) \|\| isLegacyStandaloneHarvestTask\(task\)/);
  assert.doesNotMatch(focusRoute, /HarvestWatchFocusPage|HarvestCutFocusPage/);
});

test("the Owner Rulebook includes Harvest Watch without changing the control model", () => {
  assert.match(migration, /rs\.rhythm_key in \('grow_room_care','germination_watch','harvest_watch'\)/);
  assert.match(manager, /Harvest watches/);
  assert.match(manager, /this crop’s current observation lease/);
});

test("legacy harvest evidence writes remain authenticated same-origin operations", () => {
  for (const route of [watchRoute, cutRoute]) {
    assert.match(route, /requestOrigin !== request\.nextUrl\.origin/);
    assert.match(route, /requireAtlasApiAccess/);
    assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
  }
});
