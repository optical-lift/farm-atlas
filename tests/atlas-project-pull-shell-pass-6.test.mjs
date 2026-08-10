import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/project-pull-task-detail.tsx", import.meta.url),
  "utf8",
);

test("project pull executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-method-instrument="project-pull-return"/);
  assert.doesNotMatch(source, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(source, /position: "fixed"/);
  assert.doesNotMatch(source, /bottom: 14/);
});

test("project pull preserves the durable-pool return action", () => {
  assert.match(source, /\/api\/atlas\/project-pull\/return/);
  assert.match(source, /project-pull-return-v1/);
  assert.match(source, /Not today — returned to the durable Finish Project pool\./);
  assert.match(source, /taskId: task\.task_id/);
  assert.match(source, /if \(returning \|\| busy\) return;/);
  assert.match(source, /window\.location\.assign\(returnHref\)/);
});
