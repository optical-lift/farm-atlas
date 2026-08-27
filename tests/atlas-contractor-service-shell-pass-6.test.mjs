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

test("contractor visit completion obeys canonical completion capability without trapping reschedule", () => {
  assert.match(source, /const completionBlocked = busy \|\| !completion\.canComplete/);
  assert.match(source, /if \(!actualDate \|\| saving \|\| completionBlocked\) return;/);
  assert.match(source, /disabled=\{completionBlocked \|\| Boolean\(saving\)/);
  assert.match(source, /if \(saving \|\| busy\) return;/);
  assert.doesNotMatch(source, /assembly\.readiness\.status === "blocked"/);
  assert.doesNotMatch(source, /assembly\.spine\.connection === "stops_at_move"/);
});
