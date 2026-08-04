import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const migration = read("supabase/migrations/20260804084000_gate_rhythm_weed_at_release_boundary.sql");

test("the reservoir rechecks physical Weed need immediately before release", () => {
  assert.match(migration, /ALTER FUNCTION atlas\.release_eligible_work_v1[\s\S]*RENAME TO release_eligible_work_without_weed_physical_gate_v1/);
  assert.match(migration, /occurrence\.source_kind = 'rhythm_state'/);
  assert.match(migration, /state\.rhythm_key = 'weed_stewardship'/);
  assert.match(migration, /NOT atlas\.weed_card_allows_ordinary_work_v1\(state\.subject_id, v_today\)/);
  assert.match(migration, /SET state = 'cancelled'/);
  assert.match(migration, /weedOccurrencesSuppressed/);
});

test("the ungated reservoir implementation stays internal", () => {
  assert.match(migration, /REVOKE ALL ON FUNCTION atlas\.release_eligible_work_without_weed_physical_gate_v1/);
  assert.match(migration, /has_function_privilege\([\s\S]*'service_role'[\s\S]*release_eligible_work_without_weed_physical_gate_v1/);
  assert.match(migration, /REVOKE ALL ON FUNCTION atlas\.release_eligible_work_v1/);
});

test("a second guard refuses direct rhythm Weed task insertion without physical need", () => {
  assert.match(migration, /guard_rhythm_weed_task_physical_need_v1/);
  assert.match(migration, /NEW\.metadata ->> 'rhythm_key'[\s\S]*'weed_stewardship'/);
  assert.match(migration, /Rhythm Weed work cannot be released without current physical need/);
  assert.match(migration, /BEFORE INSERT OR UPDATE OF status/);
});

test("stale released and pending clear-bed servings are retired", () => {
  assert.match(migration, /task\.status IN \('open', 'blocked'\)[\s\S]*card\.current_condition = 'clear'/);
  assert.match(migration, /SET status = 'skipped'/);
  assert.match(migration, /completedReason', 'The canonical Weed Card was physically clear before release/);
  assert.match(migration, /The rhythm was satisfied before this occurrence released/);
  assert.match(migration, /A rhythm-generated Weed task is still active for a clear Weed Card/);
});
