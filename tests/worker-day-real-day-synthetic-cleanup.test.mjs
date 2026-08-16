import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816025200_worker_day_real_day_synthetic_cleanup_v1.sql"),
  "utf8",
);

test("a real Worker Day cannot retain synthetic Weed/Mow capacity", () => {
  assert.match(migration, /if p_day<=v_today then/i);
  assert.match(migration, /Released task truth owns a real day/i);
  assert.match(migration, /'\{automaticWork\}','\[\]'::jsonb/i);
  assert.match(migration, /'\{automaticPaidMinutes\}',to_jsonb\(0\)/i);
  assert.match(migration, /else[\s\S]*automaticPaidMinutes/i);
});

test("cleanup stays inside the existing Worker Day projection", () => {
  assert.match(migration, /create or replace function atlas\.worker_day_selection_overlay_v1/i);
  assert.match(migration, /presented_work_selection_rows_v1/i);
  assert.match(migration, /clock_day_capacity_state_v2/i);
  assert.doesNotMatch(migration, /create table/i);
  assert.doesNotMatch(migration, /delete from atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.tasks/i);
});
