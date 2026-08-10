import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/farm-hand-conveyor-task-detail.tsx", import.meta.url),
  "utf8",
);

test("farm hand conveyor executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-result-instrument="farm-hand-conveyor"/);
  assert.doesNotMatch(source, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(source, /atlas-task-result-footer\{display:none/);
  assert.doesNotMatch(source, /position: "fixed"/);
  assert.doesNotMatch(source, /Move this card/);
});

test("farm hand conveyor preserves worker-specific result writes", () => {
  assert.match(source, /workerResponse: action/);
  assert.match(source, /source: "farm_hand_conveyor"/);
  assert.match(source, /record\("done", "done"\)/);
  assert.match(source, /record\("progress", "partial"/);
  assert.match(source, /record\("need", "blocked"/);
  assert.match(source, /record\("changed", "changed_plan"/);
  assert.match(source, /reportAtlasNeedLighterWork\(task\.task_id\)/);
  assert.match(source, /window\.location\.assign\(returnHref\)/);
});

test("farm hand completion and progress obey Task Move readiness without blocking support actions", () => {
  assert.match(source, /\|\|\n    !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /\(action === "done" \|\| action === "progress"\) && moveBlocked/);
  assert.match(source, /disabled=\{moveBlocked\}/);
  assert.match(source, /disabled=\{locked\}/);
});
