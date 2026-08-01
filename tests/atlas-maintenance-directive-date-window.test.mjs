import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("farm day and notification window remain separate values", () => {
  assert.match(authoring, /p_due_date date/);
  assert.match(authoring, /p_work_window_key text/);
  assert.match(authoring, /v_release_time/);
  assert.match(authoring, /v_close_time/);
  assert.match(authoring, /due_date = least/);
});
