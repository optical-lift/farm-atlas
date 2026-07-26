import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day progress reads exact-date required work without a DOM patch", () => {
  const page = read("app/day/page.tsx");
  const component = read("components/atlas/day-trail-summary.tsx");
  const css = read("components/atlas/day-trail-summary.module.css");

  assert.match(page, /DayTrailSummary/);
  assert.match(page, /task\.due_date === dateIso/);
  assert.match(page, /progressTasks/);
  assert.match(page, /!isExtraCredit\(task\)/);
  assert.match(page, /finishedProgressTasks/);
  assert.match(page, /blockedProgressTasks/);
  assert.ok(page.indexOf("<DayTrailSummary") < page.indexOf("atlas-day-route-hero"));

  assert.match(component, /aria-label="Day progress"/);
  assert.match(component, /<span>\{valueText\}<\/span>/);
  assert.match(component, /role="progressbar"/);
  assert.match(component, /No work planned/);
  assert.doesNotMatch(component, /Today’s Trail/);
  assert.doesNotMatch(component, /MutationObserver|setInterval|querySelector/);

  assert.match(css, /linear-gradient/);
  assert.match(css, /\.blocked/);
});

test("completed work returns to the bottom of the Day page", () => {
  const page = read("app/day/page.tsx");

  assert.match(page, /standaloneTasks\.map\(\(task\) => <TaskCard task=\{task\}/);
  assert.match(page, /doneDayTasks\.length/);
  assert.match(page, /doneDayTasks\.map\(\(task\) => <TaskCard task=\{task\} complete/);
  assert.doesNotMatch(page, /workOrderTasks/);
  assert.doesNotMatch(page, /complete=\{isDoneTask\(task\)\}/);
});
