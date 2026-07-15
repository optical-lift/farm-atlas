import test from "node:test";
import assert from "node:assert/strict";
import { classifyAtlasTaskWorkflow, isValidAtlasTaskId, legacyTaskRedirectCore } from "../lib/atlas/task-routing-core.js";
import { validateAtlasTransitionRequest } from "../lib/atlas/task-transition-validation-core.js";

const validTaskId = "d92dca03-5f10-4a13-963d-808d7ec9587d";
const transitions = new Set(["done", "rescheduled", "unfinished"]);

function validTransition(overrides = {}) {
  return {
    requestOrigin: "https://atlas.elmfarm.co",
    expectedOrigin: "https://atlas.elmfarm.co",
    intent: "task-transition-v1",
    taskId: validTaskId,
    transition: "done",
    supportedTransitions: transitions,
    idempotencyKey: "task:done:one-tap",
    targetDate: null,
    note: null,
    payload: {},
    existingFieldLogId: null,
    ...overrides,
  };
}

test("focused task ids require valid UUIDs", () => {
  assert.equal(isValidAtlasTaskId(validTaskId), true);
  assert.equal(isValidAtlasTaskId("not-a-task-id"), false);
});

test("workflow dispatcher preserves specialized sowing and germination", () => {
  assert.equal(classifyAtlasTaskWorkflow({ task_type: "production_sowing", metadata: { production_succession_id: validTaskId } }), "production_sowing");
  assert.equal(classifyAtlasTaskWorkflow({ task_type: "germination_check", metadata: {} }), "germination");
  assert.equal(classifyAtlasTaskWorkflow({ task_type: "weeding", metadata: {} }), "generic");
});

test("legacy task URLs redirect one way to canonical focused routes", () => {
  const redirect = legacyTaskRedirectCore(`https://atlas.elmfarm.co/task?taskId=${validTaskId}&direct=1&returnTo=%2Fowner`);
  assert.equal(redirect.pathname, `/task-focus/${validTaskId}`);
  assert.equal(redirect.searchParams.get("returnTo"), "/owner");
  assert.equal(redirect.searchParams.has("direct"), false);
});

test("legacy date and bare task routes retain compatibility", () => {
  assert.equal(legacyTaskRedirectCore("https://atlas.elmfarm.co/task?date=2026-07-15").pathname, "/day");
  assert.equal(legacyTaskRedirectCore("https://atlas.elmfarm.co/task").pathname, "/");
  assert.equal(legacyTaskRedirectCore("https://atlas.elmfarm.co/task?route=plant"), null);
});

test("same-origin and intent headers are required", () => {
  assert.equal(validateAtlasTransitionRequest(validTransition({ requestOrigin: "https://evil.example" })).status, 403);
  assert.equal(validateAtlasTransitionRequest(validTransition({ intent: null })).status, 403);
});

test("transition requests require UUID and idempotency key", () => {
  assert.equal(validateAtlasTransitionRequest(validTransition({ taskId: "bad" })).status, 400);
  assert.equal(validateAtlasTransitionRequest(validTransition({ idempotencyKey: "" })).status, 400);
});

test("next-day intent is accepted only for rescheduling", () => {
  assert.equal(validateAtlasTransitionRequest(validTransition({ transition: "rescheduled", payload: { scheduleIntent: "next_day" } })), null);
  assert.equal(validateAtlasTransitionRequest(validTransition({ transition: "done", payload: { scheduleIntent: "next_day" } })).status, 400);
});

test("rescheduled and unfinished transitions need a date or supported intent", () => {
  assert.equal(validateAtlasTransitionRequest(validTransition({ transition: "rescheduled" })).status, 400);
  assert.equal(validateAtlasTransitionRequest(validTransition({ transition: "unfinished", targetDate: "2026-07-16" })), null);
});

test("valid transition request passes validation", () => {
  assert.equal(validateAtlasTransitionRequest(validTransition()), null);
});
