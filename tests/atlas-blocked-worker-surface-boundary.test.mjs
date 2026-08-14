import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260814043203_hide_blocked_work_from_worker_surfaces_v1.sql"),
  "utf8",
);

test("blocked work is withheld from broad Farm Hand surfaces while exact Task Focus remains inspectable", () => {
  assert.match(migration, /owner_worker_day_plan_choreographed_v1/);
  assert.match(migration, /and task\.status = ''open''/);
  assert.match(migration, /worker_day_placed_task_cards_v1/);
  assert.match(migration, /and task\.status=''open''/);
  assert.match(migration, /v_target_role <> ''farm_hand'' and t\.status = ''blocked''/);
  assert.match(migration, /v_role <> ''farm_hand'' or p_task_id is not null or task\.status <> ''blocked''/);
});
