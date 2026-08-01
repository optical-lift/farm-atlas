import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("serving and prerequisite tasks link to the exact growing object", () => {
  assert.match(migration, /insert into atlas\.task_objects/);
  assert.match(migration, /v_object\.id, 'target'/);
});
