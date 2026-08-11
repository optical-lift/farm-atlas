import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811233500_normalize_assigned_worker_project_scope_v1.sql", import.meta.url),
  "utf8",
);

test("real Farm Hand execution cannot remain in project-only task scope", () => {
  assert.match(migration, /new\.task_scope='project'/);
  assert.match(migration, /new\.visibility_scope='assigned_worker'/);
  assert.match(migration, /new\.assigned_membership_id is not null/);
  assert.match(migration, /new\.task_scope:='farm_operation'/);
});

test("project identity is preserved as provenance rather than lost", () => {
  assert.match(migration, /original_task_scope/);
  assert.match(migration, /worker_execution_scope_normalized_at/);
  assert.match(migration, /project membership remains in project_task_links/);
});

test("only active assigned worker project records are reconciled", () => {
  assert.match(migration, /task\.status in \('open','blocked'\)/);
  assert.match(migration, /task\.task_scope='project'/);
  assert.match(migration, /task\.visibility_scope='assigned_worker'/);
  assert.match(migration, /task\.assigned_membership_id is not null/);
  assert.doesNotMatch(migration, /f710c9c3-6e08-48ab-8a28-e00caf78a9b2/);
});

test("future task writes maintain the worker execution invariant", () => {
  assert.match(migration, /create trigger normalize_assigned_worker_project_scope_v1/);
  assert.match(migration, /before insert or update of task_scope,visibility_scope,assigned_membership_id,metadata/);
  assert.match(migration, /on atlas\.tasks/);
});
