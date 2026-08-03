import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260803154500_fix_germination_duplicate_null_classification.sql",
  import.meta.url,
);

test("ordinary tasks cannot fall through the germination classifier on SQL null", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /v_is_germination\s*:=/);
  assert.match(source, /coalesce\(new\.task_type = 'germination_check', false\)/);
  assert.match(source, /coalesce\(new\.action_key = 'germination_check', false\)/);
  assert.match(source, /coalesce\(new\.metadata->>'task_style' = 'germination_check', false\)/);
  assert.match(source, /lower\(coalesce\(new\.title, ''\)\) like '%germin%'/);
  assert.match(source, /if not v_is_germination then return new; end if;/);
});

test("false germination metadata is removed only from non-germination tasks", async () => {
  const source = await readFile(migrationPath, "utf8");

  assert.match(source, /metadata \? 'germination_variety_key'/);
  assert.match(source, /not \(\s*coalesce\(task_type = 'germination_check', false\)/s);
  assert.match(source, /collection_member_key',''\) like 'germination:%'/);
});
