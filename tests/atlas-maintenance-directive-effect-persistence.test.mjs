import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("clock effect and target are durable directive fields", () => {
  assert.match(core, /effect_policy text not null/);
  assert.match(core, /target_condition text/);
  assert.match(authoring, /p_effect_policy/);
  assert.match(authoring, /p_target_condition/);
});
