import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day never hides canonical work by prose or by missing due date", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /function isWorkTask\(task: AtlasTaskCard\) \{\s*return task\.status !== "archived" && task\.status !== "skipped" && !isChildTask\(task\);\s*\}/s);
  assert.doesNotMatch(page, /joined\.includes\("check"\)/);
  assert.doesNotMatch(page, /joined\.includes\("verify"\)/);
  assert.match(page, /const allDayTasks = useMemo\(\(\) => tasks\.filter\(isWorkTask\), \[tasks\]\);/);
  assert.match(page, /const dayTasks = useMemo\(\(\) => tasks\.filter\(isDashboardWork\), \[tasks\]\);/);
  assert.match(page, /const mixedOpenTasks = useMemo\(\(\) => uniqueTasks\(requiredTasks\), \[requiredTasks\]\);/);
});

test("membership task reader returns presented work without Grow Room suppression", () => {
  const migration = read("supabase/migrations/20260808232000_never_hide_presented_work_from_membership_task_reader.sql");

  assert.match(migration, /presented_work_rows_v1/);
  assert.doesNotMatch(migration, /card\.task_type = 'grow_room_care'/);
  assert.doesNotMatch(migration, /coalesce\(card\.zone_key, ''\) = 'grow_room'/);
  assert.doesNotMatch(migration, /'pot_up', 'hardening_off'/);
});
