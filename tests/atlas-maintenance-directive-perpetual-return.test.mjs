import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("temporary directive resolution preserves the persistent maintenance state rows", () => {
  assert.match(authoring, /weed_card_id/);
  assert.match(authoring, /rhythm_state_id/);
  assert.doesNotMatch(completion, /delete from atlas\.(weed_cards|rhythm_state|mowing_area_state)/i);
});
