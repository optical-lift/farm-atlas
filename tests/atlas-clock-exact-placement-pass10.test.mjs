import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const sequence = read("lib/atlas/day-sequence.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const choreography = read("lib/atlas/day-choreography-server.ts");
const clock = read("components/atlas/clock/clock-surface.tsx");
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
  assert.match(clock, /if \(item\.kind === "committed_task"\) return Boolean\(item\.plannedStartAt\)/);
  assert.match(clock, /if \(item\.kind === "committed_task"\) return !item\.plannedStartAt/);
  assert.match(clock, /data-clock-timed-task="true"/);
  assert.match(clock, /data-clock-unplaced-today="true"/);
  assert.match(clock, /itemExactTime/);
  assert.match(clock, /suggestions: \[\]/);
});

test("Owner can set, change, and remove a Clock time while Farm Hand remains read only", () => {
  assert.match(clock, /type ClockRead = \{ sequence: AtlasDaySequence; canManage: boolean \}/);
  assert.match(clock, /if \(ownerSequence\) return \{ sequence: ownerSequence, canManage: true \}/);
  assert.match(clock, /canManage: false/);
  assert.match(clock, /type="time"/);
  assert.match(clock, /x-atlas-intent": "owner-clock-time-v1"/);
  assert.match(clock, /saveTaskTime\(item\.taskId as string, null\)/);
  assert.match(route, /owner_set_worker_day_task_time_api_v1/);
  assert.match(route, /request\.headers\.get\("x-atlas-intent"\)/);
});

test("Clock timing mutation remains separate from task due-date truth", () => {
  assert.doesNotMatch(route, /record_task_transition/);
  assert.doesNotMatch(route, /due_date/);
});
