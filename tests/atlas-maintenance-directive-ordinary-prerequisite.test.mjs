import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("prerequisite is an ordinary canonical task rather than a maintenance result", () => {
  assert.match(authoring, /'general', 'open'/);
  assert.match(authoring, /'prepare', 'standard'/);
  assert.doesNotMatch(authoring, /insert into atlas\.(weed_sessions|mowing_events)/i);
});
