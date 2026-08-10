import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/network-inputs-task-detail.tsx", import.meta.url),
  "utf8",
);

test("network inputs execute inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-method-instrument="network-inputs"/);
  assert.match(source, /data-atlas-result-instrument="network-inputs"/);
  assert.doesNotMatch(source, /TaskDominionTrail/);
  assert.doesNotMatch(source, /import Link from "next\/link"/);
  assert.doesNotMatch(source, /\/api\/atlas\/weather/);
});

test("network input evidence remains attached to its real checklist tasks", () => {
  assert.match(source, /transition: nextDone \? "checklist_done" : "checklist_open"/);
  assert.match(source, /completion_source: "network_input_checklist"/);
  assert.match(source, /note_kind: "network_input_findings"/);
  assert.match(source, /parent_task_id: task\.task_id/);
  assert.match(source, /childTasks=\{\[\]\}/);
});

test("network input completion waits for canonical Task Move readiness", () => {
  assert.match(source, /\|\| !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /if \(blocked\) return;/);
  assert.match(source, /disabled=\{blocked\}/);
});
