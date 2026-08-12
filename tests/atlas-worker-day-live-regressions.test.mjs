import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Price Cutter stays out of the worker feed until a harvestable pollenless crop exists", () => {
  const migration = read("supabase/migrations/20260812023000_task_crop_availability_gate_v1.sql");

  assert.match(migration, /task_crop_availability_gates/);
  assert.match(migration, /required_profile_metadata_key/);
  assert.match(migration, /'pollen_status','pollenless','harvestable'/);
  assert.match(migration, /plan_work_occurrence_v1/);
  assert.match(migration, /legacy_task_release_provenance_repaired/);
  assert.match(migration, /status='blocked'/);
  assert.match(migration, /due_date=null/);
  assert.match(migration, /visibility_scope='system_internal'/);
  assert.match(migration, /refresh_crop_availability_gates_from_harvest_v1/);
});

test("the overdue House South zinnia sowing is explicitly restored to the Aug 12 evening Day", () => {
  const migration = read("supabase/migrations/20260812125903_restore_zinnia_house_south_sowing_to_aug12_v1.sql");

  assert.match(migration, /zinnia_2026_s5_house_south_sow/);
  assert.match(migration, /due_date='2026-08-12'/);
  assert.match(migration, /worker_key='anna'/);
  assert.match(migration, /'window_key','evening'/);
  assert.match(migration, /'work_window_key','evening'/);
  assert.match(migration, /'sowing_evening_policy',true/);
});

test("partly finished Anna Weed Cards return to the serial tail instead of stealing the next day", () => {
  const migration = read("supabase/migrations/20260812125237_weed_partial_returns_to_serial_tail_v1.sql");

  assert.match(migration, /anna_weeding_rotation/);
  assert.match(migration, /coalesce\(max\(qi\.position\),0\)\+1/);
  assert.match(migration, /'requeued_partial_card',true/);
  assert.match(migration, /state='queued'/);
  assert.match(migration, /planned_due_date=null/);
  assert.match(migration, /'release_timing','next_workday'/);
  assert.match(migration, /return v_active_queue_task_id/);
});

test("gentle pressure washing exposes one current move and gates the rest behind completion", () => {
  const queue = read("supabase/migrations/20260812124733_gentle_pressure_wash_serial_queue_v1.sql");
  const restore = read("supabase/migrations/20260812125726_gentle_pressure_wash_restore_current_v1.sql");

  assert.match(queue, /anna_gentle_pressure_wash_aug_2026/);
  assert.match(queue, /completion_gated_serial/);
  assert.match(queue, /release_timing','next_workday/);
  assert.match(queue, /advance_gentle_pressure_wash_serial_queue_v1/);
  assert.match(queue, /after update of status on atlas\.tasks/i);
  assert.match(queue, /perform atlas\.release_next_task_in_queue_v1/);
  assert.match(queue, /v_queue_key,null,v_occ6,2,'queued'/);
  assert.match(queue, /v_queue_key,null,v_occ7,3,'queued'/);

  assert.match(restore, /anna_20260811_gentle_pressure_wash_detached_garage_face/);
  assert.match(restore, /'release_queue_position',1/);
  assert.match(restore, /'release_queue_state','active'/);
  assert.match(restore, /-'release_deferred'-'release_duplicate'/);
  assert.match(restore, /state='active'/);
  assert.match(restore, /state='released'/);
});
