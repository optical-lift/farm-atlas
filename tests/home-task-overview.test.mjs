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
});
