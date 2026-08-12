import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Anna can finish today's Weed Card without the same bed taking tomorrow's serial slot", () => {
  const migration = read("supabase/migrations/20260812125237_weed_partial_returns_to_serial_tail_v1.sql");

  assert.match(migration, /anna_weeding_rotation/);
  assert.match(migration, /partly finished/);
  assert.match(migration, /back of that rotation/);
  assert.match(migration, /requeued_partial_card/);
  assert.match(migration, /coalesce\(max\(qi\.position\),0\)\+1/);
  assert.match(migration, /state='planned'/);
  assert.match(migration, /planned_due_date=null/);
  assert.match(migration, /not_before_date=null/);
  assert.match(migration, /release_timing','next_workday'/);
  assert.doesNotMatch(migration, /planned_due_date=v_source\.due_date\+1/);
});

test("pressure washing owns one exact active queue item and keeps later surfaces calendarless", () => {
  const migration = read("supabase/migrations/20260812125854_worker_day_serial_queue_corrections_v1.sql");

  assert.match(migration, /release_pressure_wash_queue_item_v1/);
  assert.match(migration, /release_next_pressure_wash_task_v1/);
  assert.match(migration, /anna_gentle_pressure_wash_aug_2026/);
  assert.match(migration, /release_architecture','exact_serial_occurrence_v1'/);
  assert.match(migration, /planned_due_date=null/);
  assert.match(migration, /not_before_date=null/);
  assert.match(migration, /held_until_previous_completion/);
  assert.match(migration, /v_due_date := p_completed_date\+1/);
  assert.match(migration, /extract\(dow from v_due_date\)=0/);
  assert.match(migration, /advance_gentle_pressure_wash_serial_queue_v1/);
  assert.match(migration, /release_next_pressure_wash_task_v1\(v_item\.farm_id,v_completed_date\)/);
  assert.doesNotMatch(
    migration.match(/create or replace function atlas\.advance_gentle_pressure_wash_serial_queue_v1\(\)[\s\S]*?\$function\$;/)?.[0] ?? "",
    /release_next_task_in_queue_v1/,
  );
});

test("the remaining porch pressure-wash work joins the same completion-gated sequence", () => {
  const migration = read("supabase/migrations/20260812125854_worker_day_serial_queue_corrections_v1.sql");

  assert.match(migration, /anna_20260814_gentle_pressure_wash_front_porch/);
  assert.match(migration, /anna_20260815_gentle_pressure_wash_concrete_entrance_porch/);
  assert.match(migration, /v_front\.id,4,'queued'/);
  assert.match(migration, /v_concrete\.id,5,'queued'/);
});
