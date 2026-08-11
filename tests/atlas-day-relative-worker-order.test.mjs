import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");
const ownerBuilder = readFileSync(new URL("../components/atlas/owner-day-schedule-builder.tsx", import.meta.url), "utf8");

test("today's worker timeline reads Now, Coming up, Later instead of exposing planning dayparts", () => {
  assert.match(dayPage, /function relativeWorkerTimelineGroups/);
  assert.match(dayPage, /key: "now", label: "Now"/);
  assert.match(dayPage, /key: "coming-up", label: "Coming up"/);
  assert.match(dayPage, /key: "later", label: "Later"/);
  assert.match(dayPage, /dateIso === calendarToday\s*\? relativeWorkerTimelineGroups/);
  assert.match(dayPage, /: timelineGroups/);
});

test("Now is the one current move, future same-day work comes up, and passed windows move later", () => {
  assert.match(dayPage, /task\.task_id === currentTaskId/);
  assert.match(dayPage, /order >= currentWindowOrder/);
  assert.match(dayPage, /order < currentWindowOrder/);
  assert.match(dayPage, /\.\.\.done/);
});

test("carried work stays truthful without grading the worker", () => {
  assert.match(dayPage, />Carried work</);
  assert.match(dayPage, /Next carried move/);
  assert.match(dayPage, /Unfinished work from earlier days is still real/);
  assert.doesNotMatch(dayPage, /Fallen out of rhythm/);
  assert.doesNotMatch(dayPage, /fallen out of rhythm/);
});

test("Owner planning still uses concrete Morning Afternoon Evening windows", () => {
  assert.match(ownerBuilder, /Morning/);
  assert.match(ownerBuilder, /Afternoon/);
  assert.match(ownerBuilder, /Evening/);
  assert.match(ownerBuilder, /Tomorrow/);
  assert.match(ownerBuilder, /Next week/);
  assert.match(ownerBuilder, /Return to Atlas/);
});
