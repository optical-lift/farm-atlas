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

  assert.match(component, /role="progressbar"/);
  assert.match(component, /No work planned/);
  assert.doesNotMatch(component, />Today’s Trail</);
  assert.doesNotMatch(component, /MutationObserver|setInterval|querySelector/);

  assert.match(css, /linear-gradient/);
  assert.match(css, /\.blocked/);
});

test("progress sits above the purple hero and completed work returns to the bottom", () => {
  const page = read("app/day/page.tsx");
  const progressIndex = page.indexOf("<DayTrailSummary");
  const heroIndex = page.indexOf('<article className="atlas-day-route-hero">');
  const workOrderIndex = page.indexOf("standaloneTasks.map");
  const completeIndex = page.indexOf("doneStandaloneTasks.map");

  assert.notEqual(progressIndex, -1);
  assert.notEqual(heroIndex, -1);
  assert.ok(progressIndex < heroIndex);
  assert.notEqual(workOrderIndex, -1);
  assert.notEqual(completeIndex, -1);
  assert.ok(workOrderIndex < completeIndex);
  assert.match(page, /!routeFilter && doneStandaloneTasks\.length/);
  assert.doesNotMatch(page, /complete=\{isDoneTask\(task\)\}/);
});
