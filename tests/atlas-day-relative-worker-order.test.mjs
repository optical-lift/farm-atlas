import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");
const ownerBuilder = readFileSync(new URL("../components/atlas/owner-day-schedule-builder.tsx", import.meta.url), "utf8");

test("worker Day keeps Morning Afternoon Evening as permanent schedule structure", () => {
  assert.match(dayPage, /type DayWindowKey = "morning" \| "afternoon" \| "evening"/);
  assert.match(dayPage, /key: "morning", label: "Morning"/);
  assert.match(dayPage, /key: "afternoon", label: "Afternoon"/);
  assert.match(dayPage, /key: "evening", label: "Evening"/);
  assert.match(dayPage, /windowedTimeline\(visibleTimelineGroups\)/);
  assert.doesNotMatch(dayPage, /relativeWorkerTimelineGroups/);
});

test("clock time can choose the next open move without renaming or relocating its schedule lane", () => {
  assert.match(dayPage, /function currentDayWindow/);
  assert.match(dayPage, /function nextTaskForCurrentWindow/);
  assert.match(dayPage, /resolvedDayWindowForTask/);
  assert.match(dayPage, /mixedDaySortValue/);
  assert.match(dayPage, /window = dayWindowDefinition\(resolvedDayWindowForTask/);
});

test("carried work stays truthful without grading the worker", () => {
  assert.match(dayPage, />Carried work</);
  assert.match(dayPage, /Next carried move/);
  assert.match(dayPage, /Unfinished work from earlier days is still real/);
  assert.doesNotMatch(dayPage, /Fallen out of rhythm/);
});

test("Owner inline planning uses the same concrete day-window vocabulary", () => {
  assert.match(ownerBuilder, /Morning/);
  assert.match(ownerBuilder, /Afternoon/);
  assert.match(ownerBuilder, /Evening/);
  assert.match(ownerBuilder, /Tomorrow/);
  assert.match(ownerBuilder, /type="date"/);
  assert.match(ownerBuilder, /Return to Atlas/);
});
