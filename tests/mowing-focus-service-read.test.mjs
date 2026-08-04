import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const taskFocus = read("app/task-focus/[taskId]/page.tsx");
const migration = read("supabase/migrations/20260804082400_allow_server_mowing_focus_rhythm_read.sql");

test("mowing task focus has the narrow server rhythm read it actually uses", () => {
  assert.match(taskFocus, /\.from\("rhythm_state"\)[\s\S]*\.select\("subject_id, state, warning_at, due_at, failure_at"\)/);
  assert.match(migration, /GRANT SELECT \([\s\S]*id,[\s\S]*subject_id,[\s\S]*state,[\s\S]*warning_at,[\s\S]*due_at,[\s\S]*failure_at[\s\S]*\)[\s\S]*ON atlas\.rhythm_state[\s\S]*TO service_role/);
  assert.match(migration, /has_column_privilege\('service_role', 'atlas\.rhythm_state', 'failure_at', 'SELECT'\)/);
  assert.match(migration, /has_table_privilege\('service_role', 'atlas\.rhythm_state', 'SELECT'\)/);
  assert.doesNotMatch(migration, /GRANT SELECT\s+ON atlas\.rhythm_state/);
  assert.doesNotMatch(migration, /TO anon|TO authenticated/);
});
