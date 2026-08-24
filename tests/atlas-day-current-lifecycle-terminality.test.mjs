import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

function completionPredicateSource() {
  const start = dayPage.indexOf("function isDoneTask");
  const end = dayPage.indexOf("function isOverdueTask", start);
  assert.ok(start >= 0 && end > start, "Day must define one completion predicate before overdue handling");
  return dayPage.slice(start, end);
}

test("Day terminality follows current task lifecycle instead of historical result evidence", () => {
  const predicate = completionPredicateSource();

  assert.match(predicate, /return task\.status === "done";/);
  assert.doesNotMatch(predicate, /task_outcomes/);
  assert.doesNotMatch(predicate, /checklist_status/);
});

test("Day counts selection and completion echo share the lifecycle terminality predicate", () => {
  assert.match(dayPage, /allDayTasks\.filter\(isDoneTask\)/);
  assert.match(dayPage, /progressTasks\.filter\(isDoneTask\)/);
  assert.match(dayPage, /tasks\.filter\(\(task\) => !isDoneTask\(task\)\)/);
  assert.match(dayPage, /if \(isDoneTask\(task\)\) \{[\s\S]*?<CompletionEcho/);
});
