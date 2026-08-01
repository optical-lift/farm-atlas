import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual directive task and notification records keep explicit provenance", () => {
  assert.match(migration, /manual_maintenance_directive/);
  assert.match(migration, /source = excluded\.source/);
  assert.match(migration, /created_by_user_id/);
});
