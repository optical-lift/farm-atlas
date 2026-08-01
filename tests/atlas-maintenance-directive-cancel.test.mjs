import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("cancelling a temporary instruction preserves the perpetual card", () => {
  assert.match(authoring, /status='cancelled'/);
  assert.match(authoring, /maintenance_directive_cancelled/);
  assert.doesNotMatch(authoring, /delete from atlas\.weed_cards|delete from atlas\.rhythm_state/i);
});
