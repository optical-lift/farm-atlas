import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const correction = readFileSync(
  new URL("../supabase/migrations/20260801043300_atlas_maintenance_directive_exact_farm_day_v1.sql", import.meta.url),
  "utf8",
);

test("the selected directive date becomes the serving farm day even when the card was overdue", () => {
  assert.match(correction, /least\(coalesce\(due_date, p_due_date\), p_due_date\)/);
  assert.match(correction, /replace\(v_definition, v_old, 'p_due_date'\)/);
  assert.match(correction, /set due_date = p_due_date/);
  assert.match(correction, /original_task_due_date preserves the prior serving date/);
  assert.match(correction, /Maintenance directive farm-day postcondition failed/);
});
