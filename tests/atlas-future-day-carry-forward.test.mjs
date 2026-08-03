import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("upcoming Work days keep unresolved earlier tasks in the feed", () => {
  assert.match(dayPage, /if \(dateIso < todayIso\(\)\) return \[\];/);
  assert.doesNotMatch(dayPage, /if \(dateIso !== todayIso\(\)\) return \[\];/);
  assert.match(dayPage, /task\.due_date < dateIso/);
  assert.match(dayPage, /overdueTasks\[0\] \?\?/);
  assert.match(dayPage, /carry forward/);
  assert.match(dayPage, /These unfinished tasks remain ahead of this day’s regular work/);
});
