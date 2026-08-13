import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
const page = read("app/clock/page.tsx");
const clock = read("components/atlas/clock/clock-surface.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");

test("Clock is a first-class Atlas tab and route", () => {
  assert.match(page, /ClockSurface/);
  assert.match(frame, /pathname\.startsWith\("\/clock"\)/);
  assert.match(frame, /label: "Clock"/);
  assert.match(frame, /\/clock\?date=/);
});

test("Clock reuses Day choreography instead of creating another scheduler", () => {
  assert.match(clock, /assembleWorkerDaySequence/);
  assert.match(clock, /\/api\/atlas\/worker-day-sequence\?date=/);
  assert.match(clock, /\/api\/atlas\/day-choreography\?date=/);
  assert.match(clock, /fetchAtlasTaskCards/);
  assert.doesNotMatch(clock, /POST|PATCH|DELETE|supabase|worker_day_task_placements/);
});

test("Clock keeps Owner potential out of the worker temporal surface", () => {
  assert.match(clock, /filter\(\(item\) => item\.kind !== "potential_task"\)/);
  assert.doesNotMatch(clock, /PotentialCard|projectionEligible|Atlas suggests|Not today/);
});

test("Clock places only exact timed cues on the hour grid and leaves tasks unplaced", () => {
  assert.match(clock, /item\.anchorKind === "at_time"/);
  assert.match(clock, /item\.scheduledAt/);
  assert.match(clock, /DEFAULT_ATLAS_FARM_TIME_ZONE/);
  assert.match(clock, /Unplaced today/);
  assert.match(clock, /data-clock-no-invented-task-times="true"/);
  assert.match(clock, /Only exact time truth lands here/);
});

test("NOW is tied to the real farm service date", () => {
  assert.match(clock, /selectedToday = dateIso === today/);
  assert.match(clock, /selectedToday && nowMinute !== null/);
  assert.match(clock, /data-clock-now-line="true"/);
});
