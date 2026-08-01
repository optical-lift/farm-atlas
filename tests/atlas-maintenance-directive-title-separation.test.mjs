import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("temporary directive title never commandeers perpetual card identity", () => {
  assert.match(authoring, /v_task_title := 'Weed ' \|\| v_object\.label/);
  assert.match(authoring, /active_maintenance_directive_title/);
  assert.doesNotMatch(authoring, /set\s+title\s*=\s*btrim\(p_title\)/i);
});
