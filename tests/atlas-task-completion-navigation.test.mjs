import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const transitionClient = readFileSync(
  new URL("../lib/atlas/task-transition-client.ts", import.meta.url),
  "utf8",
);

test("completed task pages leave through a fresh document navigation", () => {
  assert.match(transitionClient, /function leaveCompletedTaskPage\(\)/);
  assert.match(transitionClient, /window\.location\.pathname !== "\/task"/);
  assert.match(transitionClient, /window\.location\.replace\(destination\)/);
  assert.match(transitionClient, /input\.transition === "done"[\s\S]*leaveCompletedTaskPage\(\)/);
});

test("completion return paths cannot reopen a task route", () => {
  assert.match(transitionClient, /value\.startsWith\("\/task"\)/);
  assert.match(transitionClient, /safeAtlasReturnPath\(params\.get\("returnTo"\)\)/);
  assert.match(transitionClient, /referrer\.origin === window\.location\.origin/);
  assert.match(transitionClient, /return "\/"/);
});

test("subtask completion stays in the checklist instead of leaving the parent task", () => {
  const leaveCallCount = (transitionClient.match(/leaveCompletedTaskPage\(\);/g) ?? []).length;
  assert.equal(leaveCallCount, 1);
  assert.match(transitionClient, /input\.transition === "checklist_done"[\s\S]*rememberChecklistVisualState/);
});
