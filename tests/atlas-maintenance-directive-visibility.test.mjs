import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual maintenance work follows assigned-worker visibility", () => {
  assert.match(authoring, /visibility_scope = 'assigned_worker'/);
  assert.match(authoring, /'assigned_worker', v_assignee\.id/);
});
