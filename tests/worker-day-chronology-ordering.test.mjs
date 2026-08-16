import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260816044000_worker_day_chronology_ordering_hardening_v1.sql"),
  "utf8",
);

test("chronology display order follows actual/proposed time while preserving selection order", () => {
  assert.match(migration, /worker_day_chronology_ordered_v1/i);
  assert.match(migration, /chronology_sort_at/i);
  assert.match(migration, /row_number\(\) over/i);
  assert.match(migration, /selectionIndex/i);
  assert.match(migration, /sequenceIndex/i);
  assert.match(migration, /startsAt/i);
});

test("untimed visible work remains ordered by its semantic day window", () => {
  assert.match(migration, /when 'morning'/i);
  assert.match(migration, /when 'afternoon'/i);
  assert.match(migration, /when 'evening'/i);
});

test("both supported Worker Day readers receive the ordered timeline", () => {
  assert.match(migration, /owner_worker_day_plan_choreographed_api_v1/i);
  assert.match(migration, /worker_self_day_plan_api_v1/i);
  const uses = migration.match(/worker_day_chronology_ordered_v1\(v_timeline,p_day\)/gi) ?? [];
  assert.equal(uses.length, 2);
});

test("ordering helper remains internal and does not write placement truth", () => {
  assert.match(migration, /revoke all on function atlas\.worker_day_chronology_ordered_v1\(jsonb,date\) from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function atlas\.worker_day_chronology_ordered_v1\(jsonb,date\) to service_role/i);
  assert.doesNotMatch(migration, /insert into atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(migration, /update atlas\.worker_day_task_placements/i);
  assert.doesNotMatch(migration, /delete from atlas\.worker_day_task_placements/i);
});
