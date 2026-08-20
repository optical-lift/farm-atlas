import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/project-pull-task-detail.tsx", import.meta.url),
  "utf8",
);

test("project pull executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.doesNotMatch(source, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(source, /position: "fixed"/);
  assert.doesNotMatch(source, /bottom: 14/);
});

test("assigned workers cannot return selected project work from the task card", () => {
  assert.doesNotMatch(source, /data-atlas-method-instrument="project-pull-return"/);
  assert.doesNotMatch(source, /\/api\/atlas\/project-pull\/return/);
  assert.doesNotMatch(source, /project-pull-return-v1/);
  assert.doesNotMatch(source, /Not this one today/);
  assert.doesNotMatch(source, /return it to the Finish Project/);
});
