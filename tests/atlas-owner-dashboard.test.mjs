import assert from "node:assert/strict";
import test from "node:test";

import { buildOwnerDashboardProjection } from "../lib/atlas/owner-dashboard-core.js";

const farm = {
  id: "farm-elm",
  stable_key: "elm_farm",
  name: "Elm Farm",
  status: "active",
};

function task(overrides = {}) {
  return {
    id: "task-default",
    farm_id: "farm-elm",
    title: "Owner action",
    task_type: "owner",
    status: "open",
    priority: "normal",
    due_date: null,
    unlock_text: null,
    blocker_text: null,
    completed_at: null,
    note: null,
    metadata: { owner_task: true },
    updated_at: "2026-07-20T12:00:00Z",
    parent_task_id: null,
    ...overrides,
  };
}

test("projects Owner actions into date sections", () => {
  const dashboard = buildOwnerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "overdue", title: "Overdue", due_date: "2026-07-19" }),
      task({ id: "today", title: "Today", due_date: "2026-07-20", priority: "high" }),
      task({ id: "week", title: "Week", due_date: "2026-07-24" }),
      task({ id: "later", title: "Later", due_date: "2026-08-01" }),
      task({ id: "undated", title: "Undated" }),
    ],
  });

  assert.equal(dashboard.farm.name, "Elm Farm");
  assert.equal(dashboard.weekEndDate, "2026-07-26");
  assert.deepEqual(dashboard.ownerActions.overdue.map((row) => row.id), ["overdue"]);
  assert.deepEqual(dashboard.ownerActions.today.map((row) => row.id), ["today"]);
  assert.deepEqual(dashboard.ownerActions.thisWeek.map((row) => row.id), ["week"]);
  assert.deepEqual(dashboard.ownerActions.later.map((row) => row.id), ["later", "undated"]);
  assert.equal(dashboard.counts.open, 5);
});

test("keeps checklist children out of the main list and counts their progress", () => {
  const dashboard = buildOwnerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "parent", title: "Parent", due_date: "2026-07-20" }),
      task({
        id: "child-open",
        title: "Open step",
        due_date: "2026-07-20",
        parent_task_id: "parent",
        metadata: { owner_task: true, is_child_task: true },
      }),
      task({
        id: "child-done",
        title: "Done step",
        status: "done",
        due_date: "2026-07-20",
        metadata: { owner_task: true, is_child_task: true, parent_task_id: "parent" },
      }),
    ],
  });

  assert.equal(dashboard.ownerActions.today.length, 1);
  assert.equal(dashboard.ownerActions.today[0].id, "parent");
  assert.equal(dashboard.ownerActions.today[0].totalSteps, 2);
  assert.equal(dashboard.ownerActions.today[0].completedSteps, 1);
});

test("separates blocked and recently completed Owner actions", () => {
  const dashboard = buildOwnerDashboardProjection({
    farm,
    todayIso: "2026-07-20",
    tasks: [
      task({ id: "blocked", status: "blocked", due_date: "2026-07-20", blocker_text: "Waiting" }),
      task({ id: "done-old", status: "done", completed_at: "2026-07-18T12:00:00Z" }),
      task({ id: "done-new", status: "done", completed_at: "2026-07-20T12:00:00Z" }),
    ],
  });

  assert.equal(dashboard.counts.blocked, 1);
  assert.equal(dashboard.ownerActions.today[0].blocker, "Waiting");
  assert.deepEqual(
    dashboard.ownerActions.recentlyDone.map((row) => row.id),
    ["done-new", "done-old"],
  );
  assert.deepEqual(dashboard.farmBlockers, []);
  assert.deepEqual(dashboard.workerExecution, []);
  assert.deepEqual(dashboard.upcomingDeadlines, []);
});
