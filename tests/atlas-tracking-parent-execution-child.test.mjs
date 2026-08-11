import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811232500_detach_execution_tasks_from_tracking_parents_v1.sql", import.meta.url),
  "utf8",
);

test("assigned worker execution cannot remain nested beneath a project-tracking-only task", () => {
  assert.match(migration, /new\.visibility_scope<>'assigned_worker'/);
  assert.match(migration, /new\.assigned_membership_id is null/);
  assert.match(migration, /project_tracking_only/);
  assert.match(migration, /new\.parent_task_id:=null/);
});

test("detaching the hierarchy edge preserves tracking-parent provenance on the execution task", () => {
  assert.match(migration, /tracking_parent_task_id/);
  assert.match(migration, /tracking_parent_title/);
  assert.match(migration, /tracking_parent_detached_at/);
  assert.match(migration, /project-state tracking only/);
});

test("existing active worker execution under tracking-only parents is reconciled generically", () => {
  assert.match(migration, /update atlas\.tasks child/);
  assert.match(migration, /from atlas\.tasks parent/);
  assert.match(migration, /child\.status in \('open','blocked'\)/);
  assert.match(migration, /child\.visibility_scope='assigned_worker'/);
  assert.match(migration, /child\.assigned_membership_id is not null/);
  assert.match(migration, /parent_task_id=null/);
  assert.doesNotMatch(migration, /07459067-d85e-478d-b9af-c1847076ee70/);
  assert.doesNotMatch(migration, /f97459cd-d9ea-450c-9e41-c36e74d98dbd/);
});

test("the invariant is maintained on future task writes", () => {
  assert.match(migration, /create trigger detach_execution_task_from_tracking_parent_v1/);
  assert.match(migration, /before insert or update of parent_task_id,visibility_scope,assigned_membership_id,metadata/);
  assert.match(migration, /on atlas\.tasks/);
});
