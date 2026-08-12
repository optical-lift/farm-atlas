import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812142203_worker_task_authoring_guard_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("worker-visible tasks reject generic action-step titles", () => {
  assert.match(migration, /worker_task_authoring_violations_v1/);
  assert.match(migration, /\^\(task\|work\|do this\|handle it\)/);
  assert.match(migration, /vague_title/);
  assert.match(migration, /vague_execution_do/);
  assert.match(migration, /vague_display_action/);
  assert.match(migration, /vague_display_subject/);
});

test("worker instructions reject vague hand-waving conditions", () => {
  assert.match(migration, /if practical\|if possible\|if available\|if convenient\|when convenient/);
  assert.match(migration, /handwave_execution_condition/);
});

test("the guard applies at the tasks table boundary for every future writer", () => {
  assert.match(migration, /before insert or update of title,metadata,visibility_scope on atlas\.tasks/);
  assert.match(migration, /when \(new\.visibility_scope='assigned_worker'\)/);
  assert.match(migration, /errcode='23514'/);
});

test("legacy missing structured fields are audited rather than silently filled from Owner notes", () => {
  assert.match(migration, /v_worker_task_execution_contract_audit/);
  assert.match(migration, /missing_display_action/);
  assert.match(migration, /missing_display_subject/);
  assert.match(migration, /missing_execution_do/);
  assert.match(migration, /missing_execution_how/);
  assert.doesNotMatch(migration, /coalesce\(task\.metadata->>'execution_do',task\.note\)/i);
});

test("worker contract audit and validator are internal services, not client-side policy", () => {
  assert.match(normalized, /revoke all on function atlas\.worker_task_authoring_violations_v1\(text,jsonb,text\) from public,anon,authenticated/);
  assert.match(normalized, /revoke all on atlas\.v_worker_task_execution_contract_audit from public,anon,authenticated/);
});
