import assert from "node:assert/strict";
import test from "node:test";

import { buildWorkerResultMemory } from "../lib/atlas/worker-results-core.js";

test("projects relational worker result memory", () => {
  const results = buildWorkerResultMemory([
    {
      transition_id: "transition-1",
      task_id: "task-1",
      task_title: "Weed Field Row 1",
      task_type: "weeding",
      transition: "done",
      note: "Finished the entire bed.",
      reason: null,
      occurred_at: "2026-07-20T15:30:00Z",
      zone_id: "zone-field",
      zone_key: "field_rows",
      zone_label: "Field Rows",
      actor_membership_id: "membership-anna",
      actor_display_name: "Anna",
      actor_worker_key: "anna",
    },
  ]);

  assert.deepEqual(results[0], {
    transitionId: "transition-1",
    taskId: "task-1",
    taskTitle: "Weed Field Row 1",
    taskType: "weeding",
    transition: "done",
    note: "Finished the entire bed.",
    reason: null,
    occurredAt: "2026-07-20T15:30:00Z",
    zoneId: "zone-field",
    zoneKey: "field_rows",
    zoneLabel: "Field Rows",
    actorMembershipId: "membership-anna",
    actorDisplayName: "Anna",
    actorWorkerKey: "anna",
  });
});

test("keeps result memory stable when optional context is absent", () => {
  const results = buildWorkerResultMemory([
    {
      transition_id: "transition-2",
      task_id: "task-2",
      transition: "blocked",
      reason: "No mulch available.",
    },
  ]);

  assert.equal(results[0].taskTitle, "Task");
  assert.equal(results[0].taskType, "general");
  assert.equal(results[0].actorDisplayName, "Farm Hand");
  assert.equal(results[0].reason, "No mulch available.");
  assert.equal(results[0].zoneLabel, null);
});
