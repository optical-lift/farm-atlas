import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260803022500_atlas_presented_work_lookup_performance.sql", import.meta.url),
  "utf8",
);

test("Presented Work resolves candidates before expanding full task cards", () => {
  assert.match(migration, /with candidate_tasks as materialized/i);
  assert.match(migration, /cross join lateral/i);
  assert.match(migration, /where card\.task_id = t\.id/i);
  assert.match(migration, /limit 1/i);
  assert.doesNotMatch(migration, /join atlas\.v_task_cards card on card\.task_id = t\.id/i);
});

test("task-linked field logs have an indexed lookup path", () => {
  assert.match(migration, /field_logs_task_metadata_idx/i);
  assert.match(migration, /metadata ->> 'task_id'/i);
  assert.match(migration, /where metadata \? 'task_id'/i);
});
