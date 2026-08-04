import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("overdue work stays on Today instead of duplicating into future Work feeds", () => {
  assert.match(dayPage, /if \(dateIso !== todayIso\(\)\) return \[\];/);
  assert.doesNotMatch(dayPage, /if \(dateIso < todayIso\(\)\) return \[\];/);
  assert.match(dayPage, /task\.due_date < dateIso/);
  assert.doesNotMatch(dayPage, /overdueTasks\[0\] \?\?/);
  assert.match(dayPage, /These unfinished tasks remain ahead of today’s regular work/);
});
