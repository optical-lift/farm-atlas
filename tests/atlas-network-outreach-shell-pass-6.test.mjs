import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detail = readFileSync(
  new URL("../components/atlas/network-outreach-task-detail.tsx", import.meta.url),
  "utf8",
);

test("network outreach no longer owns a competing assigned-task page", () => {
  assert.match(detail, /AssignedTaskExecutionShell/);
  assert.match(detail, /data-atlas-method-instrument="network-outreach"/);
  assert.match(detail, /data-atlas-result-instrument="network-outreach"/);
  assert.doesNotMatch(detail, /TaskDominionTrail/);
  assert.doesNotMatch(detail, /DominionAssignedTaskDetail/);
  assert.doesNotMatch(detail, /<main className="atlas-phone-shell/);
  assert.doesNotMatch(detail, /\/api\/atlas\/weather/);
});

test("specialized outreach behavior survives as instruments", () => {
  assert.match(detail, /\/api\/atlas\/network-outreach/);
  assert.match(detail, /network-outreach-v1/);
  assert.match(detail, /action: "save_result"/);
  assert.match(detail, /transition: "checklist_done"/);
  assert.match(detail, /action: "release_next_batch"/);
  assert.match(detail, /Book a Thursday if they’re ready/);
  assert.match(detail, /restroomDisclosed/);
});

test("closing the outreach batch fails closed on Task Move readiness", () => {
  assert.match(detail, /!assembly/);
  assert.match(detail, /assembly\.readiness\.status === "blocked"/);
  assert.match(detail, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(detail, /finishBlocked = taskBusy \|\| !controller\.allContactsDone \|\| moveBlocked/);
  assert.match(detail, /disabled=\{finishBlocked\}/);
});

test("generic child checklist is suppressed because outreach contacts keep their governed logging instrument", () => {
  assert.match(detail, /childTasks=\{\[\]\}/);
  assert.match(detail, /controller\.contacts\.map/);
  assert.match(detail, /Save result \+ mark contacted/);
});
