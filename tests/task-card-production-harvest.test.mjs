import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const weekly = read("components/atlas/weekly-harvest-task-detail.tsx");
const route = read("app/api/atlas/weekly-harvest/route.ts");
const taskPage = read("app/task-focus/[taskId]/page.tsx");
const migrationV1 = read("supabase/migrations/20260821161000_unify_weekly_harvest_card_v1.sql");
const migrationV2 = read("supabase/migrations/20260821162442_align_weekly_harvest_mockup_recording_v2.sql");

test("the weekly Thursday Harvest card is the canonical worker-facing Harvest family", () => {
  assert.match(canonical, /function isWeeklyHarvestTask\(task: AtlasTaskCard\)/);
  assert.match(canonical, /task\.task_type === "harvest"/);
  assert.match(canonical, /weekly_routine/);
  assert.match(canonical, /<WeeklyHarvestTaskDetail \{\.\.\.props\} \/>/);
  assert.match(migrationV1, /standalone_harvest_tasks_forbidden/);
  assert.match(migrationV1, /suppress_standalone_harvest_carrier_v1/);
  assert.match(migrationV1, /task_type in \('harvest','harvest_watch','crop_harvest','harvest_window'\)/);
});

test("Harvest recording follows the approved half-bucket counter grammar", () => {
  assert.match(weekly, /bucketHalves/);
  assert.match(weekly, /formatBuckets/);
  assert.match(weekly, /Remove half bucket/);
  assert.match(weekly, /Add half bucket/);
  assert.match(weekly, /setBucketHalves\(\(current\) => Math\.max\(0, current \+ delta\)\)/);
  assert.match(weekly, /resultKind: resultKind === "harvest_amount"/);
  assert.match(weekly, /Record \$\{formatBuckets\(bucketHalves\)\}/);
  assert.match(migrationV2, /positiveBucketCountIsHarvestResult/);
  assert.match(migrationV2, /'bucketIncrement',0\.5/);
});

test("Harvest amount and exceptions are mutually exclusive", () => {
  assert.match(weekly, /setException\(null\)/);
  assert.match(weekly, /setBucketHalves\(0\)/);
  assert.match(weekly, /const resultKind: ResultKind \| null = bucketHalves > 0 \? "harvest_amount" : exception/);
  assert.match(migrationV2, /result_kind='harvest_amount' and bucket_halves is not null and bucket_halves>=1/);
  assert.match(migrationV2, /result_kind in \('not_ready','deadheaded','crop_exhausted'\) and bucket_halves is null/);
});

test("the only selectable non-amount Harvest outcomes are Not ready, Deadheaded, and Crop exhausted", () => {
  for (const outcome of ["not_ready", "deadheaded", "crop_exhausted"]) {
    assert.match(weekly, new RegExp(outcome));
    assert.match(route, new RegExp(outcome));
    assert.match(migrationV2, new RegExp(outcome));
  }
  assert.doesNotMatch(weekly, /value:\s*"harvested"|value:\s*"beginning"|value:\s*"declining"|value:\s*"finished"|value:\s*"problem_or_uncertain"/);
  assert.doesNotMatch(weekly, /More remains|Harvest finished|Problem \/ uncertain/);
  assert.doesNotMatch(route, /"beginning"|"harvested"|"declining"|"finished"|"problem_or_uncertain"/);
});

test("weekly Harvest groups by canonical zone and exposes the real bed under each crop", () => {
  assert.match(weekly, /row\.zoneLabel/);
  assert.match(weekly, /<h3>\{zone\}<\/h3>/);
  assert.match(weekly, /<small>\{row\.objectLabel\}<\/small>/);
  assert.match(migrationV2, /'zoneLabel',u\.zone_label/);
  assert.match(migrationV2, /'objectLabel',u\.object_label/);
});

test("weekly Harvest API writes only through the v2 result membrane", () => {
  assert.match(route, /weekly-harvest-round-v2/);
  assert.match(route, /owner_operator_record_weekly_harvest_row_v2/);
  assert.match(route, /record_weekly_harvest_row_for_member_v2/);
  assert.match(route, /p_bucket_halves/);
  assert.doesNotMatch(route, /p_bucket_band|p_more_availability/);
  assert.match(migrationV2, /revoke execute on function atlas\.record_weekly_harvest_row_for_member_v1/);
  assert.match(migrationV2, /grant execute on function atlas\.record_weekly_harvest_row_for_member_v2/);
});

test("production Harvest never copies specimen crops, fake beds, or stem-conversion math", () => {
  for (const specimenOnly of ["White Lite", "Italian White", "BW5", "FR2", "10 stems", "20 stems"]) {
    assert.doesNotMatch(weekly, new RegExp(specimenOnly));
  }
  assert.doesNotMatch(weekly, /Growing area|Growing bed/);
});

test("legacy direct Harvest task-focus displays are not part of the canonical weekly card contract", () => {
  assert.match(migrationV1, /noStandaloneHarvestReadinessTask/);
  assert.match(migrationV1, /zoneHarvestRoundsRetired/);
  assert.match(migrationV1, /weeklyHarvestCardIsOnlyWorkerCarrier/);
  assert.doesNotMatch(canonical, /HarvestWatchFocusPage|HarvestCutFocusPage/);
  // Task-focus cleanup is required before merge: old task ids must not become a second Worker Harvest surface.
  assert.doesNotMatch(taskPage, /return <HarvestWatchFocusPage|return <HarvestCutFocusPage/);
});
