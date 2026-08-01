import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("typed instruction title stays on directive rather than replacing the perpetual card title", () => {
  assert.match(authoring, /p_directive_kind, btrim\(p_title\)/);
  assert.match(authoring, /v_task_title := 'Weed ' \|\| v_object\.label/);
  assert.match(authoring, /active_maintenance_directive_title/);
  assert.doesNotMatch(authoring, /update atlas\.tasks\s+set title\s*=\s*btrim\(p_title\)/i);
});
