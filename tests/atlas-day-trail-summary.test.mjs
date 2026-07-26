import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day Trail uses exact-date required work without reviving the DOM patch", () => {
  const page = read("app/day/page.tsx");
  const component = read("components/atlas/day-trail-summary.tsx");
  const css = read("components/atlas/day-trail-summary.module.css");

  assert.match(page, /DayTrailSummary/);
  assert.match(page, /task\.due_date === dateIso/);
  assert.match(page, /progressTasks = useMemo\(\(\) => allDayTasks\.filter\(\(task\) => !isExtraCredit\(task\)\)/);
  assert.match(page, /blockedDayTasks/);
  assert.match(page, /completed=\{doneDayTasks\.length\}/);
  assert.match(page, /total=\{progressTasks\.length\}/);

  assert.match(component, /Today’s Trail/);
  assert.match(component, /role="progressbar"/);
  assert.match(component, /No work planned/);
  assert.match(component, /blocked/);
  assert.doesNotMatch(component, /MutationObserver|setInterval|querySelector/);

  assert.match(css, /linear-gradient/);
  assert.match(css, /\.blocked/);
});

test("completed work stays in its Work Order position", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /workOrderTasks = useMemo/);
  assert.match(page, /workOrderTasks\.map\(\(task\) => <TaskCard task=\{task\} complete=\{isDoneTask\(task\)\}/);
  assert.match(page, /viewMode === "zone" && doneStandaloneTasks\.length/);
  assert.doesNotMatch(page, /viewMode === "work_order"[\s\S]{0,800}doneDayTasks\.map/);
});
