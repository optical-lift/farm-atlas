import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("directive title and instructions have bounded lengths", () => {
  assert.match(migration, /length\(btrim\(p_title\)\) > 180/);
  assert.match(migration, /length\(coalesce\(p_instructions,''\)\) > 3000/);
});
