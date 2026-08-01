import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual directive checklist is bounded", () => {
  assert.match(migration, /if v_position > 20 then exit/);
  assert.match(migration, /left\(btrim\(v_step\), 240\)/);
});
