import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual authoring remains farm-operation scoped", () => {
  assert.match(migration, /'owner_assigned', 'farm_operation'/);
  assert.match(migration, /v_assignee\.farm_id = p_farm_id|membership\.farm_id = p_farm_id/);
});
