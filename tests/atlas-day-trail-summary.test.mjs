import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day progress reads the complete visible day without a DOM patch", () => {
  const page = read("app/day/page.tsx");
  const component = read("components/atlas/day-trail-summary.tsx");
  const css = read("components/atlas/day-trail-summary.module.css");

  assert.match(page, /DayTrailSummary/);
  assert.match(page, /mixedOpenTasks/);
  assert.match(page, /progressTasks = timelineTasks/);
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

test("Day Route keeps the overdue command together, preserves completion echoes, and mixes work by timeframe", () => {
  const page = read("app/day/page.tsx");
  const css = read("app/day-route-v1.css");
  const refineCss = read("app/day-route-v1-refine.css");
  const echoCss = read("app/day-timeline-completion-echo.css");
  const overdueCss = read("app/day-overdue-quiet.css");
  const layout = read("app/layout.tsx");
  const adapter = read("lib/atlas/day-route.ts");

  const commandIndex = page.indexOf("atlas-day-command-header-with-recovery");
  const overviewIndex = page.indexOf("atlas-day-recovery-overview");
  const workOrderIndex = page.indexOf("windowedTimeline(timelineGroups)");

  assert.notEqual(commandIndex, -1);
  assert.notEqual(overviewIndex, -1);
  assert.ok(commandIndex < overviewIndex);
  assert.notEqual(workOrderIndex, -1);
  assert.ok(overviewIndex < workOrderIndex);

  assert.match(page, /nextTaskForCurrentWindow/);
  assert.match(page, /nextRecoveryTask/);
  assert.match(page, /atlas-day-route-spine/);
  assert.match(page, /atlas-day-mixed-timeline/);
  assert.match(page, /CompletionEcho/);
  assert.match(page, /group\.tasks\.map\(timelineRow\)/);
  assert.match(page, /atlas-day-recovery-overview/);
  assert.match(page, />Timeline<\/button>/);
  assert.match(page, />Zone<\/button>/);
  assert.match(page, /Morning recovery/);
  assert.match(page, /Afternoon recovery/);
  assert.match(page, /Evening recovery/);
  assert.doesNotMatch(page, /atlas-day-complete-drawer/);
  assert.doesNotMatch(page, /atlas-day-route-hero/);

  assert.match(adapter, /atlasDayTaskFamily/);
  assert.match(adapter, /atlasDayTaskCues/);
  assert.match(adapter, /atlasDayRouteState/);
  assert.match(adapter, /workClass/);
  assert.doesNotMatch(adapter, /durationLabel/);
  assert.doesNotMatch(adapter, /estimated_minutes|duration_minutes/);
  assert.match(css, /\.atlas-day-view-toggle/);
  assert.match(css, /\.atlas-day-route-current/);
  assert.match(css, /\.atlas-day-route-care/);
  assert.match(css, /\.atlas-day-route-blocked/);
  assert.match(css, /\.atlas-day-task-cues/);
  assert.match(css, /\.atlas-day-route-spine > \.atlas-day-task-card[\s\S]*?border: 0 !important/);
  assert.match(css, /\.atlas-day-work-order-group[\s\S]*?background: transparent !important/);
  assert.match(refineCss, /\.atlas-day-complete-drawer/);
  assert.match(echoCss, /\.atlas-day-completion-echo/);
  assert.match(echoCss, /\.atlas-day-task-node/);
  assert.equal(existsSync(new URL("../app/DayConsequenceTimelinePatch.tsx", import.meta.url)), false);
  assert.doesNotMatch(layout, /DayConsequenceTimelinePatch/);
  assert.match(overdueCss, /content: "Overdue"/);
  assert.match(overdueCss, /exact compact Day Route geometry/);
  assert.match(overdueCss, /\.atlas-day-recovery-count/);
  assert.match(overdueCss, /\.atlas-day-window-marker/);
  assert.match(overdueCss, /\.atlas-day-mixed-timeline \.atlas-day-overdue-task-card/);
  assert.doesNotMatch(overdueCss, /\.atlas-day-command-header-with-recovery\s*\{/);

  assert.doesNotMatch(layout, /DayHeroQuietPatch/);
  assert.match(layout, /day-route-v1\.css/);
  assert.match(layout, /day-route-v1-refine\.css/);
  assert.match(layout, /day-timeline-completion-echo\.css/);
  assert.match(layout, /day-overdue-quiet\.css/);
});
