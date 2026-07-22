import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ATLAS_FARM_HAND_TRANSITIONS,
  AtlasTaskTransitionInputError,
  atlasTaskTransitionRpcForRole,
  normalizeAtlasTaskTransitionInput,
} from "../lib/atlas/task-transition-core.js";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const LOG_ID = "22222222-2222-4222-8222-222222222222";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("task transition input normalizes the complete owner payload", () => {
  assert.deepEqual(
    normalizeAtlasTaskTransitionInput({
      taskId: TASK_ID,
      transition: "rescheduled",
      idempotencyKey: "task-request-1",
      targetDate: "2026-07-27",
      note: "Seven days after spraying",
      reason: "Post-spray interval",
      laneKey: "sowing",
      workKey: "teddy-sunflowers",
      payload: { assigneeKey: "anna" },
      existingFieldLogId: LOG_ID,
    }),
    {
      taskId: TASK_ID,
      transition: "rescheduled",
      idempotencyKey: "task-request-1",
      targetDate: "2026-07-27",
      note: "Seven days after spraying",
      reason: "Post-spray interval",
      laneKey: "sowing",
      workKey: "teddy-sunflowers",
      payload: { assigneeKey: "anna" },
      existingFieldLogId: LOG_ID,
    },
  );
});

test("rescheduling requires an ISO target date", () => {
  assert.throws(
    () => normalizeAtlasTaskTransitionInput({
      taskId: TASK_ID,
      transition: "rescheduled",
      idempotencyKey: "task-request-2",
    }),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.code === "target_date_required",
  );

  assert.throws(
    () => normalizeAtlasTaskTransitionInput({
      taskId: TASK_ID,
      transition: "rescheduled",
      idempotencyKey: "task-request-3",
      targetDate: "07/27/2026",
    }),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.code === "invalid_target_date",
  );
});

test("next-day intent preserves the familiar Tomorrow action", () => {
  const result = normalizeAtlasTaskTransitionInput({
    taskId: TASK_ID,
    transition: "rescheduled",
    idempotencyKey: "task-request-next-day",
    payload: { scheduleIntent: "next_day" },
  });

  assert.match(result.targetDate, /^\d{4}-\d{2}-\d{2}$/);
});

test("role routing preserves every familiar assigned-worker outcome", () => {
  assert.equal(
    atlasTaskTransitionRpcForRole("owner", "rescheduled"),
    "owner_record_task_transition_v1",
  );

  for (const role of ["farm_hand", "manager"]) {
    for (const transition of ATLAS_FARM_HAND_TRANSITIONS) {
      assert.equal(
        atlasTaskTransitionRpcForRole(role, transition),
        "worker_record_task_transition_v1",
        `${transition} must remain available for assigned ${role} work`,
      );
    }
  }

  for (const transition of [
    "done",
    "partial",
    "blocked",
    "not_relevant",
    "changed_plan",
    "rescheduled",
    "unfinished",
    "checklist_done",
    "checklist_open",
    "note",
  ]) {
    assert.ok(ATLAS_FARM_HAND_TRANSITIONS.includes(transition));
  }

  assert.throws(
    () => atlasTaskTransitionRpcForRole("guest", "done"),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.status === 403
      && error.code === "task_transition_role_not_allowed",
  );
});

test("task transition route uses cookie auth and forwards the full RPC payload", () => {
  const route = read("app/api/atlas/task-transition/route.ts");
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /owner_record_task_transition_v1/);
  assert.match(route, /worker_record_task_transition_v1/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /private, no-store/);
  assert.equal((route.match(/p_target_date: input\.targetDate/g) ?? []).length, 2);
  assert.equal((route.match(/p_lane_key: input\.laneKey/g) ?? []).length, 2);
  assert.equal((route.match(/p_work_key: input\.workKey/g) ?? []).length, 2);
  assert.equal((route.match(/p_existing_field_log_id: input\.existingFieldLogId/g) ?? []).length, 2);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.doesNotMatch(route, /atlasSupabase/);
  assert.doesNotMatch(route, /supabase\.rpc\("record_task_transition_v1"/);
});

test("transition client preserves idempotency and readable API errors", () => {
  const client = read("lib/atlas/task-transition-client.ts");
  assert.match(client, /idempotencyKey: scopedTransitionKey\(input\)/);
  assert.match(client, /data\.error\?\.message/);
  assert.match(client, /x-atlas-intent/);
});
