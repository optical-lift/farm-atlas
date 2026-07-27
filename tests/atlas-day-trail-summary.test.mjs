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

test("Day Route keeps Next and overview together, preserves completion echoes, and collapses completed cards", () => {
  const page = read("app/day/page.tsx");
  const css = read("app/day-route-v1.css");
  const refineCss = read("app/day-route-v1-refine.css");
  const echoCss = read("app/day-timeline-completion-echo.css");
  const layout = read("app/layout.tsx");
  const adapter = read("lib/atlas/day-route.ts");

  const commandIndex = page.indexOf('className="atlas-day-command-header"');
  const overviewIndex = page.indexOf('className="atlas-day-overview-drawer atlas-day-command-overview"');
  const workOrderIndex = page.indexOf("timelineTasks.map");
  const completeIndex = page.indexOf('className="atlas-day-overview-drawer atlas-day-complete-drawer"');

  assert.notEqual(commandIndex, -1);
  assert.notEqual(overviewIndex, -1);
  assert.ok(commandIndex < overviewIndex);
  assert.notEqual(workOrderIndex, -1);
  assert.notEqual(completeIndex, -1);
  assert.ok(workOrderIndex < completeIndex);

  assert.match(page, /atlasDayCurrentTask/);
  assert.match(page, /atlasDayIsCarePulse/);
  assert.match(page, /atlas-day-route-spine/);
  assert.match(page, /CompletionEcho/);
  assert.match(page, /filteredTimelineTasks\.map\(timelineRow\)/);
  assert.match(page, /<details className="atlas-day-overview-drawer atlas-day-command-overview">/);
  assert.match(page, /<details className="atlas-day-overview-drawer atlas-day-complete-drawer">/);
  assert.match(page, />Timeline<\/button>/);
  assert.match(page, />Zone<\/button>/);
  assert.doesNotMatch(page, /<h3>Timeline<\/h3>/);
  assert.match(page, /!routeFilter && doneStandaloneTasks\.length/);
  assert.doesNotMatch(page, /atlas-day-route-hero/);

  assert.match(adapter, /atlasDayTaskFamily/);
  assert.match(adapter, /atlasDayTaskCues/);
  assert.match(adapter, /atlasDayRouteState/);
  assert.match(adapter, /durationLabel/);
  assert.match(adapter, /return `\$\{rounded\} hr`/);
  assert.match(css, /\.atlas-day-view-toggle/);
  assert.match(css, /\.atlas-day-route-current/);
  assert.match(css, /\.atlas-day-route-care/);
  assert.match(css, /\.atlas-day-route-blocked/);
  assert.match(css, /\.atlas-day-task-cues/);
  assert.match(css, /\.atlas-day-route-spine > \.atlas-day-task-card[\s\S]*?border: 0 !important/);
  assert.match(css, /\.atlas-day-work-order-group[\s\S]*?background: transparent !important/);
  assert.match(refineCss, /\.atlas-day-complete-drawer/);
  assert.match(refineCss, /\.atlas-day-complete-drawer \.atlas-day-task-card > strong/);
  assert.match(echoCss, /\.atlas-day-completion-echo/);
  assert.match(echoCss, /\.atlas-day-task-node/);

  assert.doesNotMatch(layout, /DayHeroQuietPatch/);
  assert.match(layout, /day-route-v1\.css/);
  assert.match(layout, /day-route-v1-refine\.css/);
  assert.match(layout, /day-timeline-completion-echo\.css/);
});
