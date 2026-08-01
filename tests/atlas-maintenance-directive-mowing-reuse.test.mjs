import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("mowing directives release through the governed rhythm state", () => {
  assert.match(authoring, /rhythm_key = 'mowing'/);
  assert.match(authoring, /subject_kind = 'growing_object'/);
  assert.match(authoring, /ensure_rhythm_task_v1\(v_rhythm_state\.id, 'due', v_due_at\)/);
  assert.doesNotMatch(authoring, /v_task_title := 'Mow/);
});
