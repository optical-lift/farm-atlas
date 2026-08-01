import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("every directive has exactly one persistent maintenance owner", () => {
  assert.match(core, /maintenance_kind = 'weed' and weed_card_id is not null and rhythm_state_id is null/);
  assert.match(core, /maintenance_kind = 'mow' and rhythm_state_id is not null and weed_card_id is null/);
});
