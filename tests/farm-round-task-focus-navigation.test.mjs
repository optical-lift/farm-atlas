import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Farm Round remains specialized while Task Focus navigation stays route-owned", () => {
  const layout = read("app/task-focus/[taskId]/layout.tsx");
  const registry = read("components/atlas/canonical-assigned-task-detail.tsx");
  const round = read("components/atlas/farm-round-task-detail.tsx");

  assert.match(layout, /<TaskFocusNavigationBoundary fallbackPath="\/" showCloseControl>/);
  assert.match(registry, /if \(isFarmRoundTask\(props\.task\)\) return <FarmRoundTaskDetail \{\.\.\.props\} \/>/);
  assert.doesNotMatch(registry, /TaskFocusNavigationBoundary/);
  assert.doesNotMatch(round, /AssignedTaskExecutionShell/);
  assert.match(round, /postAtlasTaskTransition\(\{ taskId: member\.task_id/);
  assert.match(round, /farmRoundParentTaskId: task\.task_id/);
});

test("the route boundary owns close UI and the canonical leave contract", () => {
  const boundary = read("components/atlas/task-focus-navigation-boundary.tsx");

  assert.match(boundary, /showCloseControl\?: boolean/);
  assert.match(boundary, /aria-label="Close task"/);
  assert.match(boundary, /onClick=\{leave\}/);
  assert.match(boundary, /className="atlas-task-focus-close"/);
  assert.match(boundary, /leaveTaskFocus\(fallbackPath\)/);
});
