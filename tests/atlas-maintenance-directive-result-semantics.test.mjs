import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("temporary instruction completion comes only from canonical maintenance evidence", () => {
  assert.match(completion, /after insert on atlas\.weed_sessions/);
  assert.match(completion, /new\.condition_after/);
  assert.match(completion, /after insert on atlas\.mowing_events/);
  assert.match(completion, /new\.outcome/);
  assert.doesNotMatch(completion, /after update[^\n]+atlas\.tasks[\s\S]{0,250}complete_matching_maintenance_directives/i);
});

test("full and target effects cannot be satisfied by a generic task click", () => {
  assert.match(completion, /effect_policy='full_maintenance'/);
  assert.match(completion, /maintenance_kind='weed' and p_result_value='clear'/);
  assert.match(completion, /maintenance_kind='mow' and p_result_value='mowed_full'/);
  assert.match(completion, /effect_policy='target_condition'/);
  assert.match(completion, /weed_condition_rank_v1/);
});
