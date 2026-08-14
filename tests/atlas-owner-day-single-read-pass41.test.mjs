import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const gate = read("components/atlas/owner-day-plan-gate.tsx");
const interleaved = read("components/atlas/owner-interleaved-day-projection.tsx");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");

test("Owner Day gate reuses AtlasRuntime instead of probing Worker Day plan separately", () => {
  assert.match(gate, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.doesNotMatch(gate, /\/api\/atlas\/worker-day-plan/);
  assert.doesNotMatch(gate, /fetch\(/);
  assert.match(gate, /sequence\.paidTargetMinutes/);
  assert.match(gate, /sequence\.committedPaidMinutes/);
  assert.match(gate, /sequence\.automaticPaidMinutes/);
  assert.match(gate, /sequence\?\.availableWorkerDay/);
});

test("Owner interleaved projection consumes the same runtime sequence and refreshes through runtime", () => {
  assert.match(interleaved, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(interleaved, /void reload\(\)/);
  assert.doesNotMatch(interleaved, /\/api\/atlas\/worker-day-sequence/);
  assert.doesNotMatch(interleaved, /fetch\(/);
  assert.doesNotMatch(interleaved, /SequenceResponse/);
});

test("unified projection carries the planning summary needed by Owner Day chrome", () => {
  assert.match(sequenceServer, /availableWorkerDay: plan\.availableWorkerDay/);
  assert.match(sequenceServer, /paidTargetMinutes: plan\.paidTargetMinutes/);
  assert.match(sequenceServer, /committedPaidMinutes: plan\.committedPaidMinutes/);
  assert.match(sequenceServer, /automaticPaidMinutes: plan\.automaticPaidMinutes/);
  assert.match(projectionClient, /AtlasWorkerDayRuntimeSequence/);
  assert.match(projectionClient, /operatorLabel/);
});

test("Pass 41 does not move the edit drawer onto browser-owned scheduling", () => {
  assert.match(gate, /<OwnerDayScheduleBuilder \/>/);
  assert.match(gate, /<OwnerDayCueEditor \/>/);
  assert.doesNotMatch(gate, /assembleWorkerDaySequence|deriveAtlasTimingMobility|workOrderNumber/);
  assert.doesNotMatch(interleaved, /assembleWorkerDaySequence|deriveAtlasTimingMobility/);
});
