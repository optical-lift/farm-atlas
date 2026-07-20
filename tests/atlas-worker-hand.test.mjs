import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkerHandProjection } from "../lib/atlas/worker-hand-core.js";

const context = {
  farm_id: "farm-elm",
  farm_name: "Elm Farm",
  viewer_role: "farm_hand",
  worker_membership_id: "membership-anna",
  worker_display_name: "Anna",
  worker_key: "anna",
  can_act: true,
  unassigned_worker_task_count: 0,
};

function task(overrides = {}) {
  return {
    task_id: "task-default",
    title: "Weed the bed",
    task_type: "weeding",
    status: "open",
    priority: "normal",
    due_date: "2026-07-20",
    instruction: "Remove weeds around the crop.",
    blocker_text: null,
    zone_id: "zone-field",
    zone_key: "field_rows",
    zone_label: "Field Rows",
    assigned_membership_id: "membership-anna",
    visibility_scope: "assigned_worker",
    task_lane: "today",
    total_steps: 0,
    completed_steps: 0,
    can_act: true,
    ...overrides,
  };
}

test("builds a worker hand from safe prepared fields", () => {
  const hand = buildWorkerHandProjection({
    context,
    forDate: "2026-07-20",
    tasks: [task()],
  });

  assert.equal(hand.farm.name, "Elm Farm");
  assert.equal(hand.worker.displayName, "Anna");
  assert.equal(hand.canAct, true);
  assert.equal(hand.counts.total, 1);
  assert.equal(hand.lanes.today[0].title, "Weed the bed");
  assert.equal(hand.lanes.today[0].zoneLabel, "Field Rows");
});

test("separates blocked, overdue, today, and undated lanes", () => {
  const hand = buildWorkerHandProjection({
    context,
    forDate: "2026-07-20",
    tasks: [
      task({ task_id: "blocked", task_lane: "blocked", status: "blocked" }),
      task({ task_id: "overdue", task_lane: "overdue", due_date: "2026-07-19" }),
      task({ task_id: "today", task_lane: "today" }),
      task({ task_id: "undated", task_lane: "undated", due_date: null }),
    ],
  });

  assert.equal(hand.counts.blocked, 1);
  assert.equal(hand.counts.overdue, 1);
  assert.equal(hand.counts.today, 1);
  assert.equal(hand.counts.undated, 1);
});

test("returns an empty management inspection state before a Farm Hand exists", () => {
  const hand = buildWorkerHandProjection({
    context: {
      farm_id: "farm-elm",
      farm_name: "Elm Farm",
      viewer_role: "owner",
      worker_membership_id: null,
      worker_display_name: "Farm Hand",
      worker_key: null,
      can_act: false,
      unassigned_worker_task_count: "103",
    },
    forDate: "2026-07-20",
    tasks: [],
  });

  assert.equal(hand.worker, null);
  assert.equal(hand.canAct, false);
  assert.equal(hand.unassignedWorkerTaskCount, 103);
  assert.equal(hand.counts.total, 0);
});

test("keeps Owner and Manager inspection read-only", () => {
  const hand = buildWorkerHandProjection({
    context: { ...context, viewer_role: "manager", can_act: false },
    forDate: "2026-07-20",
    tasks: [task({ can_act: false })],
  });

  assert.equal(hand.canAct, false);
  assert.equal(hand.lanes.today[0].canAct, false);
});
