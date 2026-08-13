import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const surface = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const controls = read("components/atlas/clock/clock-owner-controls.tsx");
const layout = read("lib/atlas/clock-layout.ts");
const durationRoute = read("app/api/atlas/owner-day-task-duration/route.ts");

test("Clock renders planned duration as real vertical blocks", () => {
  assert.match(surface, /buildClockTaskRanges/);
  assert.match(surface, /layoutClockTaskRanges/);
  assert.match(timeline, /data-clock-duration-blocks="true"/);
  assert.match(timeline, /layout\.span\.minutes/);
  assert.match(timeline, /height = layout\.span\.minutes/);
});

test("overlapping planned blocks receive separate visual lanes", () => {
  assert.match(layout, /laneIndex/);
  assert.match(layout, /laneCount/);
  assert.match(layout, /laneEnds/);
  assert.match(timeline, /data-conflict=/);
  assert.match(timeline, /Overlaps another planned block/);
});

test("Clock NOW and NEXT use temporal ranges", () => {
  assert.match(surface, /activeRange/);
  assert.match(surface, /chooseClockNextTask/);
  assert.match(surface, /range\.startMinute <= nowMinute/);
  assert.match(surface, /range\.endMinute > nowMinute/);
});

test("Owner can explicitly commit or remove a planned span", () => {
  assert.match(controls, /owner-clock-duration-v1/);
  assert.match(controls, /durationMinutes: parsedDuration/);
  assert.match(controls, /durationMinutes: null/);
  assert.match(durationRoute, /owner_set_worker_day_task_duration_api_v1/);
  assert.match(durationRoute, /durationMinutes must be an integer from 5 to 720/);
});

test("Farm Hand duration controls remain absent because controls require canManage", () => {
  assert.match(controls, /if \(!props\.canManage \|\| !item\.taskId\) return null/);
  assert.match(surface, /canManage/);
});
