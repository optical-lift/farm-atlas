import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/buyer-outreach-task-detail.tsx", import.meta.url),
  "utf8",
);

test("buyer outreach executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-result-instrument="buyer-outreach"/);
  assert.match(source, /data-atlas-method-instrument="buyer-outreach-script"/);
  assert.doesNotMatch(source, /TaskDominionTrail/);
  assert.doesNotMatch(source, /import Link from "next\/link"/);
  assert.doesNotMatch(source, /<main className="atlas-phone-shell/);
});

test("buyer outreach preserves its canonical contact and completion writes", () => {
  assert.match(source, /\/api\/atlas\/buyer-outreach/);
  assert.match(source, /buyer-outreach-v1/);
  assert.match(source, /transition: "checklist_done"/);
  assert.match(source, /transition: "done"/);
  assert.match(source, /completion_source: "buyer_outreach_batch"/);
});

test("buyer outreach result mutations obey Task Move readiness", () => {
  assert.match(source, /if \(blocked\) return;/);
  assert.match(source, /disabled=\{blocked \|\| saving\}/);
  assert.match(source, /disabled=\{blocked \|\| closing \|\| !allContactsDone\}/);
  assert.match(source, /childTasks=\{\[\]\}/);
});
