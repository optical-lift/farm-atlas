import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/page.tsx", "utf8");
const component = readFileSync("components/atlas/home/AtlasUniversalHomeV2.tsx", "utf8");
const overview = readFileSync("lib/atlas/home-task-overview.ts", "utf8");
const css = readFileSync("app/home-task-overview.css", "utf8");

test("Home uses the prepared Living Day instead of journal-cover miscellany", () => {
  assert.match(page, /readAtlasOperatorHomeTaskOverview/);
  assert.match(overview, /living_day_v1/);
  assert.match(overview, /livingDay\.journal\.planned/);
  assert.doesNotMatch(page, /readAtlasOperatorJournalCover/);
});

test("the purple cover is a four-task overview in canonical work order", () => {
  assert.match(overview, /atlasWorkOrderSortValue/);
  assert.match(overview, /slice\(0, 4\)/);
  assert.match(overview, /Current/);
  assert.match(overview, /Next/);
  assert.match(overview, /Later/);
  assert.match(component, /atlas-home-task-overview-card/);
  assert.match(component, /"Finish"/);
});

test("prepared journal tasks fill overview slots when the farm-card cache is incomplete", () => {
  assert.match(overview, /AtlasJournalTask/);
  assert.match(overview, /cardsById/);
  assert.match(overview, /taskRefMove/);
  assert.match(overview, /preparedOpen/);
});

test("Home reports the bounded plan and leaves project movement in Projects", () => {
  assert.match(component, /dealt with/);
  assert.match(component, /carry forward/);
  assert.doesNotMatch(component, /function MovingNow/);
  assert.match(css, /Moving Now belongs exclusively to the Projects tab/);
});

test("task cards show useful real task data without clipping every title", () => {
  assert.match(overview, /atlasDayTaskFamily/);
  assert.match(overview, /atlasDayTaskCues/);
  assert.match(overview, /display\.location/);
  assert.match(css, /-webkit-line-clamp: unset/);
  assert.match(css, /atlas-home-task-overview-action/);
  assert.match(css, /grid-template-rows: minmax\(0, 1fr\) auto/);
  assert.match(css, /position: static !important/);
});

test("the task hero and compact week rail size to their real contents", () => {
  assert.match(css, /\.atlas-home-task-overview[\s\S]*height: auto !important/);
  assert.match(css, /grid-template-rows: auto auto !important/);
  assert.match(css, /section\[aria-label="Days in this week"\][\s\S]*height: auto !important/);
  assert.match(css, /section\[aria-label="Days in this week"\] > div:first-child[\s\S]*display: flex !important/);
  assert.match(css, /section\[aria-labelledby="atlas-home-pulse-title"\][\s\S]*min-height: 0 !important/);
});
