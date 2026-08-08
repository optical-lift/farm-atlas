import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day trusts the canonical presented-work reader instead of hiding tasks by prose keywords", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /function isWorkTask\(task: AtlasTaskCard\) \{\s*return task\.status !== "archived" && task\.status !== "skipped" && !isChildTask\(task\);\s*\}/s);
  assert.doesNotMatch(page, /joined\.includes\("check"\)/);
  assert.doesNotMatch(page, /joined\.includes\("verify"\)/);
  assert.doesNotMatch(page, /joined\.includes\("walk field rows"\)/);
});

test("an exact Day read keeps scheduled Grow Room work while broad Home reads may still consolidate it", () => {
  const migration = read("supabase/migrations/20260808230000_keep_exact_day_presented_work_visible.sql");

  assert.match(migration, /v_due_through = v_day/);
  assert.match(migration, /presented_work_rows_v1/);
  assert.match(migration, /'pot_up'/);
  assert.match(migration, /or \(\s*\(\s*card\.task_type = 'grow_room_care'/s);
});
