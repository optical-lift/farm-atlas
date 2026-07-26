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
  assert.match(page, /<DayTrailSummary compact/);

  assert.match(component, /role="progressbar"/);
  assert.match(component, /No work planned/);
  assert.doesNotMatch(component, />Today’s Trail</);
  assert.doesNotMatch(component, /MutationObserver|setInterval|querySelector/);

  assert.match(css, /linear-gradient/);
  assert.match(css, /\.compact/);
  assert.match(css, /\.blocked/);
});

test("Day Route v1 merges Next with overview and lets the timeline stand on its own", () => {
  const page = read("app/day/page.tsx");
  const css = read("app/day-route-v1.css");
  const layout = read("app/layout.tsx");
  const adapter = read("lib/atlas/day-route.ts");

  const commandIndex = page.indexOf('className="atlas-day-command-header"');
  const overviewIndex = page.indexOf('className="atlas-day-overview-drawer atlas-day-command-overview"');
  const workOrderIndex = page.indexOf("standaloneTasks.map");
  const completeIndex = page.indexOf("doneStandaloneTasks.map");

  assert.notEqual(commandIndex, -1);
  assert.notEqual(overviewIndex, -1);
  assert.ok(commandIndex < overviewIndex);
  assert.notEqual(workOrderIndex, -1);
  assert.notEqual(completeIndex, -1);
  assert.ok(workOrderIndex < completeIndex);

  assert.match(page, /atlasDayCurrentTask/);
  assert.match(page, /atlasDayIsCarePulse/);
  assert.match(page, /atlas-day-route-spine/);
  assert.match(page, /<details className="atlas-day-overview-drawer atlas-day-command-overview">/);
  assert.match(page, />Timeline<\/button>/);
  assert.match(page, />Zone<\/button>/);
  assert.match(page, /!routeFilter && doneStandaloneTasks\.length/);
  assert.doesNotMatch(page, /atlas-day-route-hero/);

  assert.match(adapter, /atlasDayTaskFamily/);
  assert.match(adapter, /atlasDayTaskCues/);
  assert.match(adapter, /atlasDayRouteState/);
  assert.match(css, /\.atlas-day-view-toggle/);
  assert.match(css, /\.atlas-day-route-current/);
  assert.match(css, /\.atlas-day-route-care/);
  assert.match(css, /\.atlas-day-route-blocked/);
  assert.match(css, /\.atlas-day-task-cues/);
  assert.match(css, /\.atlas-day-route-spine > \.atlas-day-task-card[\s\S]*?border: 0 !important/);
  assert.match(css, /\.atlas-day-work-order-group[\s\S]*?background: transparent !important/);

  assert.doesNotMatch(layout, /DayHeroQuietPatch/);
  assert.match(layout, /day-route-v1\.css/);
});
