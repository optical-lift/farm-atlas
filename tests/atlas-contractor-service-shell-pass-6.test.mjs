import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL("../components/atlas/contractor-service-task-detail.tsx", import.meta.url),
  "utf8",
);

test("contractor service executes inside the universal task shell", () => {
  assert.match(source, /AssignedTaskExecutionShell/);
  assert.match(source, /data-atlas-result-instrument="contractor-service"/);
  assert.doesNotMatch(source, /TaskDominionTrail/);
  assert.doesNotMatch(source, /import Link from "next\/link"/);
  assert.doesNotMatch(source, /<main className="atlas-phone-shell/);
  assert.doesNotMatch(source, /\/api\/atlas\/weather/);
});

test("contractor service preserves visit and not-yet writes", () => {
  assert.match(source, /\/api\/atlas\/contractor-service/);
  assert.match(source, /contractor-service-visit-v1/);
  assert.match(source, /serviceDate: actualDate/);
  assert.match(source, /transition: "rescheduled"/);
  assert.match(source, /targetDate: nextWorkingDay\(today\)/);
  assert.match(source, /contractorServiceStatus: "not_yet"/);
});

test("contractor visit completion obeys Task Move readiness without trapping reschedule", () => {
  assert.match(source, /\|\| !assembly/);
  assert.match(source, /assembly\.readiness\.status === "blocked"/);
  assert.match(source, /assembly\.spine\.connection === "stops_at_move"/);
  assert.match(source, /if \(!actualDate \|\| saving \|\| moveBlocked\) return;/);
  assert.match(source, /disabled=\{moveBlocked \|\| Boolean\(saving\)/);
  assert.match(source, /if \(saving \|\| busy\) return;/);
});
