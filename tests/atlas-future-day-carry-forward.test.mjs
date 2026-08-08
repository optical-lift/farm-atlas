import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("recovery labeling stays on Today while each future Day trusts its canonical presented-work feed", () => {
  assert.match(dayPage, /if \(dateIso !== todayIso\(\)\) return \[\];/);
  assert.doesNotMatch(dayPage, /if \(dateIso < todayIso\(\)\) return \[\];/);
  assert.match(dayPage, /task\.due_date < dateIso/);
  assert.match(dayPage, /const mixedOpenTasks = useMemo\(\(\) => uniqueTasks\(requiredTasks\), \[requiredTasks\]\);/);
  assert.match(dayPage, /Every unfinished recovery task is placed in the real day/);
  assert.match(dayPage, /atlas-day-mixed-timeline/);
  assert.doesNotMatch(dayPage, /These unfinished tasks remain ahead of today’s regular work/);
});
