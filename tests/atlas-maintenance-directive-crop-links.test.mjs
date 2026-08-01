import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("selected crop cycles must belong to the same farm and object", () => {
  assert.match(authoring, /cycle\.farm_id = p_farm_id and cycle\.object_id = v_object\.id/);
  assert.match(authoring, /maintenance_directive_crop_cycles/);
  assert.match(authoring, /task_crop_cycles/);
  assert.match(authoring, /confidence='confirmed'/);
  assert.match(authoring, /source='maintenance_directive'/);
});
