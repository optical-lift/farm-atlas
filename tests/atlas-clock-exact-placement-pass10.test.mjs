import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const sequence = read("lib/atlas/day-sequence.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const choreography = read("lib/atlas/day-choreography-server.ts");
const surface = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const unplaced = read("components/atlas/clock/clock-unplaced-v2.tsx");
const controls = read("components/atlas/clock/clock-owner-controls.tsx");
const ownerReader = read("components/atlas/clock/clock-owner-reader.ts");
const route = read("app/api/atlas/owner-day-task-time/route.ts");

test("Clock exact starts are choreography truth carried through the shared Day sequence", () => {
  assert.match(choreography, /plannedStartAt: string \| null/);
  assert.match(choreography, /plannedStartAt: nullableString\(row\.plannedStartAt\)/);
  assert.match(sequence, /AtlasDaySequencePlacementInput/);
  assert.match(sequence, /plannedStartAt: string \| null/);
  assert.match(sequence, /placements\?: AtlasDaySequencePlacementInput\[\]/);
  assert.match(sequence, /placementByTask/);
  assert.match(sequenceServer, /placements: sameTarget \? \(choreography\?\.placements \?\? \[\]\) : \[\]/);
});

test("Clock moves only exact committed starts onto the hourly grid", () => {
  assert.match(surface, /buildClockTaskRanges\(committed/);
  assert.match(unplaced, /item\.kind === "committed_task" \? !item\.plannedStartAt/);
  assert.match(timeline, /data-clock-timed-task="true"/);
  assert.match(unplaced, /data-clock-unplaced-today="true"/);
  assert.match(projectionClient, /suggestions: \[\]/);
});

test("Owner can set, change, and remove a Clock time while Farm Hand remains read only", () => {
  assert.match(ownerReader, /readOwnerClockProjection/);
  assert.match(ownerReader, /readOwnerClockSequence/);
  assert.match(surface, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(projectionClient, /ownerProjection\) return \{ projection: ownerProjection, canManage: true \}/);
  assert.match(projectionClient, /canManage: false/);
  assert.match(controls, /type="time"/);
  assert.match(controls, /owner-clock-time-v1/);
  assert.match(controls, /localTime: null/);
  assert.match(route, /owner_set_worker_day_task_time_api_v1/);
  assert.match(route, /request\.headers\.get\("x-atlas-intent"\)/);
});

test("Clock timing mutation remains separate from task due-date truth", () => {
  assert.doesNotMatch(route, /record_task_transition/);
  assert.doesNotMatch(route, /due_date/);
});
