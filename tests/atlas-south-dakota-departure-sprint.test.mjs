import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804130500_south_dakota_departure_finish_sprint_v1.sql", import.meta.url),
  "utf8",
);

test("the departure milestone derives from real tasks instead of a duplicate master checklist", () => {
  assert.match(migration, /elm_south_dakota_departure_finish_20260805/);
  assert.match(migration, /Finish Elm Before South Dakota Departure/);
  assert.match(migration, /link_real_tasks_do_not_create_master_checklist/);
  assert.match(migration, /project_task_links/);
  assert.match(migration, /Expected 23 real departure tasks/);
  assert.match(migration, /Expected 21 checklist conditions inside coherent task clusters/);
});

test("the duplicate repair retires superseded umbrellas and stale attic-door work", () => {
  for (const title of [
    "Marshall — Move Dryer Downstairs",
    "Owner + Marshall — Finish Entry Floor + Trim Around Laundry/Hutch",
    "Marshall — Complete Venue Bathroom Punch Items",
    "Owner — Marshall Finish Day",
  ]) {
    assert.ok(migration.includes(title));
  }

  for (const taskKey of [
    "marshall_attic_door_04_cut_frame_bottom",
    "marshall_attic_door_05_measure_doorway_gap",
    "marshall_attic_door_06_make_gap_filler",
    "marshall_attic_door_07_install_gap_filler",
    "marshall_attic_door_10_finish_gaps",
  ]) {
    assert.ok(migration.includes(taskKey));
  }

  assert.match(migration, /Duplicate active departure task identities remain/);
  assert.match(migration, /state = 'completed'/);
});

test("the confirmed owner and physical outcomes remain canonical", () => {
  assert.match(migration, /marshall_20260804_move_hutch_library_to_entry/);
  assert.match(migration, /Marshall — Move Hutch from Library to Entry/);
  assert.match(migration, /owner_20260804_reimburse_melody/);
  assert.match(migration, /visibility_scope = 'management'/);
  assert.match(migration, /marshall_20260804_install_working_basement_dryer/);
  assert.match(migration, /Marshall — Install Working Dryer in Basement/);
  assert.match(migration, /Plumbing cluster must contain five distinct repair tasks/);
});

test("nothing in the sprint can drift past Wednesday morning", () => {
  assert.match(migration, /departure_hard_stop/);
  assert.match(migration, /departureDate', '2026-08-05/);
  assert.match(migration, /task\.due_date > date '2026-08-05'/);
  assert.match(migration, /A departure task is scheduled after Wednesday morning/);
});
