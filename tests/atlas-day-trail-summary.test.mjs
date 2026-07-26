import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day Trail reads exact-date required work without a DOM patch", () => {
  const page = read("app/day/page.tsx");
  const component = read("components/atlas/day-trail-summary.tsx");
  const css = read("components/atlas/day-trail-summary.module.css");

  assert.match(page, /DayTrailSummary/);
  assert.match(page, /task\.due_date === dateIso/);
  assert.match(page, /progressTasks/);
  assert.match(page, /!isExtraCredit\(task\)/);
  assert.match(page, /finishedProgressTasks/);
  assert.match(page, /blockedProgressTasks/);

  assert.match(component, /Today’s Trail/);
  assert.match(component, /role="progressbar"/);
  assert.match(component, /No work planned/);
  assert.doesNotMatch(component, /MutationObserver|setInterval|querySelector/);

  assert.match(css, /linear-gradient/);
  assert.match(css, /\.blocked/);
});

test("completed standalone work stays in its Work Order position", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /workOrderTasks/);
  assert.match(page, /complete=\{isDoneTask\(task\)\}/);
  assert.match(page, /viewMode === "zone" && doneStandaloneTasks\.length/);
});
