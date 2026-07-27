import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../lib/atlas/task-transition-core.js", import.meta.url), "utf8");
const route = readFileSync(new URL("../app/api/atlas/task-transition/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260727173000_day_timeline_safe_reopen.sql", import.meta.url), "utf8");

test("reopened is a first-class transition with role-scoped RPCs", () => {
  assert.match(core, /"reopened"/);
  assert.match(core, /owner_reopen_task_completion_v1/);
  assert.match(core, /worker_reopen_task_completion_v1/);
  assert.match(route, /owner_correction_required/);
  assert.match(route, /worker_reopen_task_completion_v1/);
});

test("safe reopen retracts evidence and refuses acted-on consequences", () => {
  assert.match(migration, /reopen_task_completion_v1_internal/);
  assert.match(migration, /crop or production evidence/);
  assert.match(migration, /Downstream work has already been acted on/);
  assert.match(migration, /retracted_field_log_id/);
  assert.match(migration, /objectStateBefore/);
  assert.match(migration, /task_release_queue_items/);
  assert.match(migration, /satisfaction_retracted_at/);
  assert.match(migration, /'reopened'/);
});
