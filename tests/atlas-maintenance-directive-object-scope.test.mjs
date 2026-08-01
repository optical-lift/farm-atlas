import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual maintenance directive resolves one exact object inside the active farm", () => {
  assert.match(authoring, /object_row\.farm_id = p_farm_id and object_row\.stable_key = btrim\(p_object_key\)/);
});
