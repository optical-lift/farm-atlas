import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const choreography = read("lib/atlas/day-choreography-server.ts");
const sequence = read("lib/atlas/worker-day-sequence-server.ts");

test("Owner Worker Day sequence reuses the plan target for choreography", () => {
  assert.match(sequence, /readWorkerDayChoreographyForTarget\(dateIso, planResult\.target\)/);
  assert.doesNotMatch(sequence, /readOwnerWorkerDayChoreography/);
});

test("target-scoped choreography does not resolve identity again", () => {
  const helperStart = choreography.indexOf("export async function readWorkerDayChoreographyForTarget");
  const publicStart = choreography.indexOf("export async function readWorkerDayChoreography(dateIso");
  assert.ok(helperStart >= 0 && publicStart > helperStart);
  const helper = choreography.slice(helperStart, publicStart);
  assert.doesNotMatch(helper, /resolveDayChoreographyTarget/);
  assert.doesNotMatch(helper, /resolveOwnerWorkerDayPlanningTarget/);
  assert.doesNotMatch(helper, /getAtlasSession/);
  assert.match(helper, /worker_day_choreography_api_v1/);
  assert.match(helper, /readAtlasDayReservations/);
});

test("standalone Worker Day choreography keeps its authorization resolution path", () => {
  assert.match(choreography, /export async function readWorkerDayChoreography\(dateIso: string\)[\s\S]*resolveDayChoreographyTarget\(\)/);
  assert.match(choreography, /if \(!target\) return \{ active: false as const/);
  assert.match(choreography, /return readWorkerDayChoreographyForTarget\(dateIso, target\)/);
});
