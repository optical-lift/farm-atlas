import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("directive cannot silently link a crop from another bed", () => {
  assert.match(authoring, /cycle\.object_id = v_object\.id/);
  assert.match(authoring, /cycle\.farm_id = p_farm_id/);
});
