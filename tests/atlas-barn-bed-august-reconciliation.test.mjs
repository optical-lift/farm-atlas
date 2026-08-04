import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const physicalTruth = readFileSync(
  new URL("../supabase/migrations/20260804103000_bb8_bb9_horizon_physical_truth_v1.sql", import.meta.url),
  "utf8",
);
const sowingTask = readFileSync(
  new URL("../supabase/migrations/20260804103100_reconcile_bb10_horizon_sowing_task_v1.sql", import.meta.url),
  "utf8",
);
const treatment = readFileSync(
  new URL("../supabase/migrations/20260804103200_bb10_bermuda_treatment_and_august_tasks_v1.sql", import.meta.url),
  "utf8",
);
const retireBb11 = readFileSync(
  new URL("../supabase/migrations/20260804103300_retire_nonexistent_bb11_v1.sql", import.meta.url),
  "utf8",
);

test("BB8 and BB9 own confirmed ProCut Horizon sowing truth", () => {
  assert.match(physicalTruth, /ProCut Horizon was sown in Barn Beds 8 and 9/);
  assert.match(physicalTruth, /sown_date=date '2026-08-03'/);
  assert.match(physicalTruth, /actual_sow_source','marshall_text_20260804'/);
  assert.match(physicalTruth, /confidence='owner_confirmed'/);
  assert.match(physicalTruth, /'owner_confirmed','owner_report'/);
  assert.doesNotMatch(physicalTruth, /confidence='confirmed'/);
});

test("the old four-bed sow card becomes the one remaining BB10 outcome", () => {
  assert.match(sowingTask, /Sow ProCut Horizon in BB10/);
  assert.match(sowingTask, /owner_20260825_sow_procut_horizon_bb10/);
  assert.match(sowingTask, /delete from atlas\.task_objects where task_id=v_parent_task_id and object_id<>v_bb10_id/);
  assert.match(sowingTask, /completed_from_physical_truth/);
  assert.match(sowingTask, /Replaced by the canonical BB10 sowing task behind Bermuda-grass treatment/);
});

test("BB10 has three fixed treatment dates and remains unavailable until reassessment", () => {
  for (const date of ["2026-08-04", "2026-08-14", "2026-08-24", "2026-08-25"]) {
    assert.match(treatment, new RegExp(date));
  }
  assert.match(treatment, /operational_truth='unavailable_for_planting'/);
  assert.match(treatment, /state='paused'/);
  assert.match(treatment, /ordinaryWeedWorkSuppressed/);
  assert.match(treatment, /owner_20260804_spray_bb10_bermuda_pass_1/);
  assert.match(treatment, /owner_20260814_spray_bb10_bermuda_pass_2/);
  assert.match(treatment, /owner_20260824_spray_bb10_bermuda_pass_3/);
  assert.match(treatment, /owner_20260825_confirm_bb10_ready_to_sow/);
  assert.match(treatment, /'deferred_hidden'/);
  assert.match(treatment, /reconcile_task_prerequisite_gate_v1/);
});

test("Anna receives the three requested one-off tasks on the authored dates", () => {
  assert.match(treatment, /anna_20260804_grey_couch_garage','Grey Couch in Garage/);
  assert.match(treatment, /anna_20260805_school_preschool_enrollment','School and Preschool Enrollment/);
  assert.match(treatment, /anna_20260805_wash_dry_store_soil_blockers','Wash, Dry \+ Store Soil Blockers on Garage Shelf/);
  assert.match(treatment, /simple_completion_task/);
});

test("Barn Beds end at BB10 without mutating append-only rhythm history", () => {
  assert.match(retireBb11, /10 Barn Beds, about 18 ft x 3 ft each/);
  assert.match(retireBb11, /historical_tombstone_nonexistent_bb11/);
  assert.match(retireBb11, /canonicalDeleted/);
  assert.match(retireBb11, /Append-only rhythm satisfaction history retains this UUID/);
  assert.match(retireBb11, /delete from atlas\.task_objects where object_id=v_bb11_id/);
  assert.match(retireBb11, /delete from atlas\.crop_cycles where object_id=v_bb11_id/);
  assert.doesNotMatch(retireBb11, /delete from atlas\.growing_objects/);
});
