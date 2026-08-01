import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("object-first directive creation is one transactional database action", () => {
  assert.match(migration, /^begin;/);
  assert.match(migration, /create_object_maintenance_directive_v1/);
  assert.match(migration, /commit;\s*$/);
});
