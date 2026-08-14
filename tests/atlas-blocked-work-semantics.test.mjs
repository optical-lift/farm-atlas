import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { assembleTaskMoveCore } from "../lib/atlas/task-move-assembly-core.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const migration = readFileSync(
  join(root, "supabase/migrations/20260814042514_enforce_blocked_work_semantics_v1.sql"),
  "utf8",
);

test("a blocked task is held at MOVE rather than remaining executable", () => {
  const result = assembleTaskMoveCore({
    task: {
      task_id: "77777777-7777-4777-8777-777777777777",
      title: "Pick up Home Depot order",
      task_type: "errand",
      status: "blocked",
      priority: "normal",
      blocker_text: "Home Depot order is not ready for pickup yet.",
      metadata: {
        current_truth: "The order has not been released for pickup.",
        after_truth: "The order is at Elm Farm.",
      },
      objects: [],
      resource_requirements: [],
      action_templates: [],
    },
    execution: {
      doText: "Pick up Home Depot order",
      placeText: "Home Depot",
      howLines: [],
      doneWhen: "The order is at Elm Farm.",
      details: null,
      dueLabel: "Today",
    },
    display: {
      action: "Pick up",
      subject: "Home Depot order",
      location: "Home Depot",
      route: "errand",
    },
    moveSemantics: {
      route: "errand",
      instruction: "Pick up Home Depot order",
      placeLabel: "Home Depot",
      dueLabel: "Today",
    },
    moveContext: null,
  });

  assert.equal(result.readiness.status, "blocked");
  assert.equal(result.readiness.executable, false);
  assert.equal(result.spine.connection, "stops_at_move");
  assert.equal(result.requirements.some((item) => item.label === "Home Depot order is not ready for pickup yet."), true);
});

test("production migration prevents blocked-to-done and excludes blocked work from the worker day", () => {
  assert.match(migration, /old\.status = 'blocked' and new\.status = 'done'/);
  assert.match(migration, /Blocked work must be unblocked before it can be completed/);
  assert.match(migration, /and t\.status = ''open''/);
  assert.match(migration, /where t\.status = ''open''/);
  assert.doesNotMatch(migration, /and t\.status in \(''open'',''blocked''\)/);
});
