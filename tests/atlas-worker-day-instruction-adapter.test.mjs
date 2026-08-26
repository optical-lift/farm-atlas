import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkerHandProjection } from "../lib/atlas/worker-hand-core.js";

test("Worker Day surfaces canonical execution_how before its legacy instruction fallback", () => {
  const projection = buildWorkerHandProjection({
    context: {
      farm_id: "farm-1",
      farm_name: "Elm Farm",
      viewer_role: "farm_hand",
      worker_membership_id: "worker-1",
      worker_display_name: "Worker",
      can_act: true,
      unassigned_worker_task_count: 0,
    },
    forDate: "2026-08-26",
    tasks: [
      {
        task_id: "task-1",
        title: "Harvest off-site flowers",
        task_type: "general",
        status: "open",
        priority: "normal",
        due_date: "2026-08-26",
        instruction: "Legacy note without the contact instruction.",
        task_lane: "today",
        can_act: true,
        metadata: {
          execution_how: [
            "Give yourself about 45 minutes to harvest.",
            "Contact: (417) 555-0123",
            "Text from the farm's shared phone before leaving.",
          ],
          display_detail: "This should remain a fallback, not override Steps.",
        },
      },
    ],
  });

  assert.equal(
    projection.lanes.today[0]?.instruction,
    "Give yourself about 45 minutes to harvest. · Contact: (417) 555-0123 · Text from the farm's shared phone before leaving.",
  );
});

test("Worker Day retains display-detail and legacy instruction fallbacks when canonical Steps are absent", () => {
  const projection = buildWorkerHandProjection({
    context: {},
    forDate: "2026-08-26",
    tasks: [
      {
        task_id: "task-detail",
        title: "Detail fallback",
        task_lane: "today",
        instruction: "Legacy note",
        metadata: { display_detail: "Canonical visible detail" },
      },
      {
        task_id: "task-legacy",
        title: "Legacy fallback",
        task_lane: "today",
        instruction: "Legacy note",
        metadata: {},
      },
    ],
  });

  assert.equal(projection.lanes.today[0]?.instruction, "Canonical visible detail");
  assert.equal(projection.lanes.today[1]?.instruction, "Legacy note");
});
