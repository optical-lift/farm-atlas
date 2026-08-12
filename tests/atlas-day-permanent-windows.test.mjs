import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const day = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("worker Day keeps Morning, Afternoon, and Evening as permanent structural lanes", () => {
  assert.match(day, /key: "morning", label: "Morning"/);
  assert.match(day, /key: "afternoon", label: "Afternoon"/);
  assert.match(day, /key: "evening", label: "Evening"/);
  assert.match(day, /const visibleTimelineGroups = timelineGroups/);
  assert.doesNotMatch(day, /relativeWorkerTimelineGroups/);
  assert.doesNotMatch(day, /label: "Now"/);
  assert.doesNotMatch(day, /label: "Coming up"/);
  assert.doesNotMatch(day, /label: "Later"/);
});

test("current time marks a lane without renaming or moving its tasks", () => {
  assert.match(day, /data-current-window=\{isCurrentWindow \? "true" : "false"\}/);
  assert.match(day, /isCurrentWindow \? " · current window" : ""/);
  assert.match(day, /group\.key === currentDayWindow\(localHour\)/);
});

test("completion styling is orthogonal to canonical placement order", () => {
  const sortFunction = day.slice(day.indexOf("function mixedDaySortValue"), day.indexOf("function uniqueTasks"));
  assert.doesNotMatch(sortFunction, /doneRank/);
  assert.doesNotMatch(sortFunction, /isDoneTask\(task\)/);
  assert.match(day, /if \(isDoneTask\(task\)\) \{\s*return <CompletionEcho/);
  assert.match(day, /group\.tasks\.map\(timelineRow\)/);
});

test("an overdue recurring occurrence is labeled as the old occurrence, not a newly generated daily chore", () => {
  assert.match(day, /function recurringOccurrence\(task: AtlasTaskCard\)/);
  assert.match(day, /repeat_interval_days/);
  assert.match(day, /repeat_rule/);
  assert.match(day, /task_series_key/);
  assert.match(day, /occurrence · still open · due/);
});
