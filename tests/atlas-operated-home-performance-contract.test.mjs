import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const repoRoot = process.cwd();
const read = (filePath) => fs.readFileSync(path.join(repoRoot, filePath), "utf8");

test("operated Farm Hand Home selects work without rich task-card hydration", () => {
  const migration = read("supabase/migrations/20260814180000_operator_home_light_read_model_v1.sql");
  assert.match(migration, /presented_work_selection_rows_v1/);
  assert.match(migration, /member_day_carryover_v1/);
  assert.match(migration, /owner_operator_home_task_cards_lite_v1/);
  assert.doesNotMatch(migration, /task_card_for_id_v1/);
  assert.doesNotMatch(migration, /atlas\.v_task_cards/);
});

test("operated Home public RPC delegates to the lightweight read model", () => {
  const migration = read("supabase/migrations/20260814182000_operator_home_switch_to_light_read_v1.sql");
  assert.match(migration, /owner_operator_universal_home_fast_v1/);
  assert.doesNotMatch(migration, /atlas\.universal_home_v1\s*\(/);
  assert.match(migration, /grant execute[\s\S]*authenticated/i);
});
