import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("instruction and prerequisite crop links use distinct canonical roles", () => {
  assert.match(migration, /case when p_directive_kind='prerequisite' then 'prerequisite' else 'affects' end/);
});
