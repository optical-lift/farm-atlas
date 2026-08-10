import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/project-pull-task-detail.tsx", import.meta.url),
  "utf8",
);

const shell = readFileSync(
  new URL("../components/atlas/assigned-task-execution-shell.tsx", import.meta.url),
  "utf8",
);

test("project pull keeps the universal task shell and adds one supplemental result", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /supplementalResultInstrument=/);
  assert.match(source, /data-atlas-supplemental-result-instrument="project-pull-return"/);
  assert.doesNotMatch(source, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(source, /position:\s*"fixed"/);
});

test("project pull preserves its durable pool return write", () => {
  assert.match(source, /\/api\/atlas\/project-pull\/return/);
  assert.match(source, /project-pull-return-v1/);
  assert.match(source, /returned to the durable Finish Project pool/);
  assert.match(source, /window\.location\.assign\(returnHref\)/);
});

test("the universal shell owns supplemental results instead of bespoke page chrome", () => {
  assert.match(shell, /supplementalResultInstrument\?: AssignedTaskResultInstrument/);
  assert.match(shell, /supplementalResultInstrument \? supplementalResultInstrument\(instrumentContext\) : null/);
});
