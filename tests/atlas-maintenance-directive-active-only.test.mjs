import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("object and task readers show only active temporary directives", () => {
  assert.match(core, /directive\.status = 'active'/);
  assert.match(core, /where directive\.status = 'active'/);
});
