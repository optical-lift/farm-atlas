import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("target-condition directives accept only Weed Card physical states", () => {
  assert.match(authoring, /p_target_condition not in \('row_readable','mostly_clear','clear'\)/);
  assert.match(authoring, /Mowing directives use bring-forward, full-maintenance, or inspection effects/);
});
