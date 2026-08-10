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
  assert.doesNotMatch(source, /position:\s*"fixed"/);
});

test("farm hand conveyor preserves worker response semantics", () => {
  assert.match(source, /source: "farm_hand_conveyor"/);
  assert.match(source, /workerResponse: action/);
  assert.match(source, /record\("progress", "partial"/);
  assert.match(source, /record\("need", "blocked"/);
  assert.match(source, /record\("changed", "changed_plan"/);
  assert.match(source, /reportAtlasNeedLighterWork/);
});

test("farm hand completion waits for canonical Task Move readiness", () => {
  assert.match(source, /\|\| !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /if \(action === "done" && blockedDone\) return;/);
  assert.match(source, /disabled=\{blockedDone\}/);
});
