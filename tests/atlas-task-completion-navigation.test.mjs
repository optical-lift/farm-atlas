import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const transitionClient = readFileSync(
  new URL("../lib/atlas/task-transition-client.ts", import.meta.url),
  "utf8",
);
const executionShell = readFileSync(
  new URL("../components/atlas/assigned-task-execution-shell.tsx", import.meta.url),
  "utf8",
);

test("legacy completed task pages leave through a fresh document navigation", () => {
  assert.match(transitionClient, /function leaveCompletedTaskPage\(\)/);
  assert.match(transitionClient, /window\.location\.pathname !== "\/task"/);
  assert.match(transitionClient, /window\.location\.replace\(destination\)/);
  assert.match(transitionClient, /if \(input\.transition === "done"\) \{\s*leaveCompletedTaskPage\(\);\s*\}/);
});

test("completion return paths cannot reopen a task route", () => {
  assert.match(transitionClient, /value\.startsWith\("\/task"\)/);
  assert.match(transitionClient, /safeAtlasReturnPath\(params\.get\("returnTo"\)\)/);
  assert.match(transitionClient, /referrer\.origin === window\.location\.origin/);
  assert.match(transitionClient, /return "\/"/);
});

test("subtask completion stays in the checklist instead of triggering parent-page navigation", () => {
  const leaveCallCount = (transitionClient.match(/leaveCompletedTaskPage\(\);/g) ?? []).length;
  assert.equal(leaveCallCount, 1);
  assert.match(transitionClient, /if \(input\.transition === "done"\) \{\s*leaveCompletedTaskPage\(\);\s*\}/);
  assert.doesNotMatch(transitionClient, /if \(input\.transition === "checklist_done"\) \{\s*leaveCompletedTaskPage\(\);/);
});

test("checklist state is refreshed by the React execution owner instead of a global DOM observer", () => {
  assert.doesNotMatch(transitionClient, /rememberChecklistVisualState|MutationObserver|data-child-task-id|classList/);
  assert.match(executionShell, /async function refreshTaskAndChildren\(\)/);
  assert.match(executionShell, /setChildren\(data\.taskCards/);
  assert.match(executionShell, /onChange=\{refreshTaskAndChildren\}/);
});
