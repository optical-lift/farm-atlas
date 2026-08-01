import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("prerequisite is one ordinary task that gates the persistent card", () => {
  assert.match(authoring, /maintenance_prerequisite/);
  assert.match(authoring, /'unlocks_task_id', v_task_id/);
  assert.match(authoring, /set status = 'blocked'/);
  assert.match(completion, /after update of status on atlas\.tasks/);
  assert.match(completion, /new\.status <> 'done'/);
  assert.match(completion, /set status='open', blocker_text=null/);
});
