import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
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

test("role routing keeps owner and Farm-Hand mutation boundaries separate", () => {
  assert.equal(
    atlasTaskTransitionRpcForRole("owner", "rescheduled"),
    "owner_record_task_transition_v1",
  );
  assert.equal(
    atlasTaskTransitionRpcForRole("farm_hand", "done"),
    "worker_record_task_transition_v1",
  );
  assert.throws(
    () => atlasTaskTransitionRpcForRole("farm_hand", "rescheduled"),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.status === 403
      && error.code === "farm_hand_transition_not_allowed",
  );
  assert.throws(
    () => atlasTaskTransitionRpcForRole("manager", "done"),
    (error) => error instanceof AtlasTaskTransitionInputError
      && error.status === 403
      && error.code === "manager_transition_not_available",
  );
});

test("task transition route uses cookie auth and role-specific RPCs", () => {
  const route = read("app/api/atlas/task-transition/route.ts");
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(route, /owner_record_task_transition_v1/);
  assert.match(route, /worker_record_task_transition_v1/);
  assert.match(route, /x-atlas-intent/);
  assert.match(route, /private, no-store/);
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
