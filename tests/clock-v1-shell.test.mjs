import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }
const page = read("app/clock/page.tsx");
const surfaceEntry = read("components/atlas/clock/clock-surface.tsx");
const surface = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const unplaced = read("components/atlas/clock/clock-unplaced-v2.tsx");
const ownerReader = read("components/atlas/clock/clock-owner-reader.ts");
const workerReader = read("components/atlas/clock/clock-worker-reader.ts");
const controls = read("components/atlas/clock/clock-owner-controls.tsx");
const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");

test("Clock is a first-class Atlas tab and route", () => {
  assert.match(page, /ClockSurface/);
  assert.match(surfaceEntry, /clock-orchestrator/);
  assert.match(frame, /pathname\.startsWith\("\/clock"\)/);
  assert.match(frame, /label: "Clock"/);
  assert.match(frame, /\/clock\?date=/);
});

test("Clock reuses Day choreography instead of creating another scheduler", () => {
  assert.match(workerReader, /assembleWorkerDaySequence/);
  assert.match(ownerReader, /\/api\/atlas\/worker-day-sequence\?date=/);
  assert.match(workerReader, /\/api\/atlas\/day-choreography\?date=/);
  assert.match(workerReader, /fetchAtlasTaskCards/);
  assert.match(controls, /\/api\/atlas\/owner-day-task-time/);
  assert.doesNotMatch(surface, /supabase|worker_day_task_placements/);
});

test("Clock keeps Owner potential out of the worker temporal surface", () => {
  assert.match(surface, /filter\(\(item\) => item\.kind !== "potential_task"\)/);
  assert.match(workerReader, /suggestions: \[\]/);
  assert.doesNotMatch(surface, /PotentialCard|projectionEligible|Atlas suggests|Not today/);
});

test("Clock places only exact time truth on the hour grid and leaves untimed work unplaced", () => {
  assert.match(surface, /item\.anchorKind === "at_time"/);
  assert.match(surface, /item\.scheduledAt/);
  assert.match(surface, /buildClockTaskRanges\(committed/);
  assert.match(timeline, /data-clock-timed-task="true"/);
  assert.match(timeline, /DEFAULT_ATLAS_FARM_TIME_ZONE/);
  assert.match(unplaced, /Unplaced today/);
  assert.match(unplaced, /data-clock-unplaced-today="true"/);
});

test("NOW is tied to the real farm service date", () => {
  assert.match(surface, /selectedToday = dateIso === today/);
  assert.match(surface, /selectedToday \? clockLocalMinuteOfDay/);
  assert.match(timeline, /data-clock-now-line="true"/);
});
