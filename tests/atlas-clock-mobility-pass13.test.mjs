import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const mobility = read("lib/atlas/timing-mobility.ts");
const sequence = read("lib/atlas/day-sequence.ts");
const planServer = read("lib/atlas/worker-day-plan-server.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const unplaced = read("components/atlas/clock/clock-unplaced-v2.tsx");
const css = read("components/atlas/clock/clock-surface-v2.module.css");

test("Pass 13 defines fixed anchored windowed flexible and potential mobility", () => {
  assert.match(mobility, /fixed/);
  assert.match(mobility, /anchored/);
  assert.match(mobility, /windowed/);
  assert.match(mobility, /flexible/);
  assert.match(mobility, /potential/);
  for (const field of ["fixedLocalTime", "windowStartAt", "windowEndAt", "anchorTaskId", "anchorRelation", "minimumGapMinutes", "travelLocation", "placementReason"]) assert.match(mobility, new RegExp(field));
});

test("task metadata supplies real clock constraints without turning a hard date into a fixed time", () => {
  for (const field of ["pickup_window_start", "pickup_window_end", "scheduled_time_24h", "must_complete_before_departure", "follow_up_after_task_id"]) assert.match(mobility, new RegExp(field));
  assert.doesNotMatch(mobility, /hard_date/);
});

test("shared Day sequence carries mobility for committed potential and cue items", () => {
  assert.match(sequence, /mobility/);
  assert.match(sequence, /timingClass: potential/);
  assert.match(sequence, /exact Elm Farm time/);
  assert.match(sequence, /immediately before its task/);
});

test("Owner and Farm Hand Clock derive mobility from task metadata", () => {
  assert.match(planServer, /deriveAtlasTimingMobility/);
  assert.match(planServer, /commitment_kind, metadata/);
  assert.match(projectionClient, /deriveAtlasTimingMobility/);
  assert.match(projectionClient, /metadata: task.metadata/);
});

test("Clock visually distinguishes mobility classes", () => {
  assert.match(timeline, /data-timing-class/);
  assert.match(unplaced, /data-timing-class/);
  assert.match(timeline, /atlasTimingClassLabel/);
  assert.match(unplaced, /atlasTimingClassLabel/);
  for (const value of ["fixed", "windowed", "anchored", "flexible"]) assert.match(css, new RegExp(`data-timing-class=.${value}.`));
});