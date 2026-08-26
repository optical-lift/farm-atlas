import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Round adopts the shared Task Focus navigation boundary without entering generic execution", () => {
  const registry = read("components/atlas/canonical-assigned-task-detail.tsx");
  const round = read("components/atlas/farm-round-task-detail.tsx");

  assert.match(registry, /TaskFocusNavigationBoundary/);
  assert.match(registry, /isFarmRoundTask\(props\.task\)[\s\S]*TaskFocusNavigationBoundary[\s\S]*FarmRoundTaskDetail/);
  assert.match(registry, /showCloseControl/);
  assert.doesNotMatch(round, /AssignedTaskExecutionShell/);
  assert.match(round, /postAtlasTaskTransition\(\{ taskId: member\.task_id/);
  assert.match(round, /farmRoundParentTaskId: task\.task_id/);
});

test("the shared boundary owns Farm Round close UI and uses the canonical leave contract", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");

  assert.match(boundary, /showCloseControl\?: boolean/);
  assert.match(boundary, /aria-label="Close task"/);
  assert.match(boundary, /onClick=\{\(\) => leaveTaskFocus\(fallbackPath\)\}/);
  assert.match(boundary, /className="atlas-task-focus-close"/);
});
