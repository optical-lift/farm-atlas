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
  assert.doesNotMatch(source, /<main className="atlas-phone-shell/);
});

test("network inputs keep their specialized child checklist and store findings as structured results", () => {
  assert.match(source, /childTasks=\{\[\]\}/);
  assert.match(source, /transition: nextDone \? "checklist_done" : "checklist_open"/);
  assert.match(source, /completion_source: "network_input_checklist"/);
  assert.match(source, /StructuredWorkResultForm/);
  assert.match(source, /heading="Source"/);
  assert.match(source, /submitLabel="Save source"/);
  assert.doesNotMatch(source, /transition: "note"/);
  assert.doesNotMatch(source, /note_kind: "network_input_findings"/);
  assert.doesNotMatch(source, /<textarea/);
  assert.match(source, /parent_task_id: task\.task_id/);
  assert.match(source, /input_key: text\(input\.metadata\?\.network_input_key\)/);
});

test("network inputs completion obeys Task Move readiness while unfinished remains a navigation action", () => {
  assert.match(source, /\|\|\n      !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /if \(moveBlocked\) return;/);
  assert.match(source, /disabled=\{moveBlocked\}/);
  assert.match(source, /window\.location\.assign\(context\.returnHref\)/);
});
