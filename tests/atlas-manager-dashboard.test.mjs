import assert from "node:assert/strict";
import test from "node:test";

import { buildManagerDashboardProjection } from "../lib/atlas/manager-dashboard-core.js";

const farm = {
  id: "farm-elm",
  stable_key: "elm_farm",
  name: "Elm Farm",
  status: "active",
};

function task(overrides = {}) {
  return {
    id: "task-default",
    title: "Management task",
    task_type: "general",
    status: "open",
    priority: "normal",
    due_date: null,
    unlock_text: null,
    blocker_text: null,
    note: null,
    metadata: {},
    visibility_scope: "management",
    assigned_membership_id: null,
    parent_task_id: null,
    ...overrides,
  };
}

test("separates management and worker queues", () => {
  const dashboard = buildManagerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "management" }),
      task({ id: "worker", visibility_scope: "assigned_worker" }),
      task({ id: "shared", visibility_scope: "farm_shared" }),
    ],
  });

  assert.deepEqual(
    dashboard.managementQueue.map((row) => row.id),
    ["management", "shared"],
  );
  assert.deepEqual(dashboard.workerQueue.map((row) => row.id), ["worker"]);
  assert.deepEqual(dashboard.unassignedWorker.map((row) => row.id), ["worker"]);
});

test("tracks blocked, overdue, and due-today work", () => {
  const dashboard = buildManagerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "blocked", status: "blocked", due_date: "2026-07-20", blocker_text: "Waiting" }),
      task({ id: "overdue", due_date: "2026-07-19" }),
      task({ id: "today", due_date: "2026-07-20" }),
    ],
  });

  assert.equal(dashboard.counts.blocked, 1);
  assert.equal(dashboard.counts.overdue, 1);
  assert.equal(dashboard.counts.today, 2);
  assert.equal(dashboard.blocked[0].blocker, "Waiting");
});

test("does not surface checklist children as top-level management work", () => {
  const dashboard = buildManagerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "parent" }),
      task({ id: "child", parent_task_id: "parent" }),
      task({ id: "legacy-child", metadata: { parent_task_id: "parent" } }),
    ],
  });

  assert.deepEqual(dashboard.managementQueue.map((row) => row.id), ["parent"]);
  assert.equal(dashboard.counts.open, 1);
});
