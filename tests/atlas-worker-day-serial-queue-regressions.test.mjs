import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Anna weeding advances the serial queue instead of recreating the same Weed Card tomorrow", () => {
  const migration = read("supabase/migrations/20260812131500_worker_day_serial_queue_corrections_v1.sql");

  assert.match(migration, /release_weed_card_continuation_unqueued_v1/);
  assert.match(migration, /weed_serial_gate/);
  assert.match(migration, /anna_weeding_rotation/);
  assert.match(migration, /serial_queue_owns_daily_serving/);
  assert.match(migration, /set state='cancelled'/);
  assert.match(migration, /return null;/);
  assert.match(migration, /release_weed_card_continuation_unqueued_v1\(p_occurrence_id,p_source_task_id\)/);
});

test("pressure washing owns one exact active queue item and keeps later surfaces calendarless", () => {
  const migration = read("supabase/migrations/20260812131500_worker_day_serial_queue_corrections_v1.sql");

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
  const migration = read("supabase/migrations/20260812131500_worker_day_serial_queue_corrections_v1.sql");

  assert.match(migration, /anna_20260814_gentle_pressure_wash_front_porch/);
  assert.match(migration, /anna_20260815_gentle_pressure_wash_concrete_entrance_porch/);
  assert.match(migration, /v_front\.id,4,'queued'/);
  assert.match(migration, /v_concrete\.id,5,'queued'/);
});
