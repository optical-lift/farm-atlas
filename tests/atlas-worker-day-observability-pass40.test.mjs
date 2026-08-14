import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const route = read("app/api/atlas/worker-day-sequence/route.ts");

test("Worker Day production timing covers the server-owned request phases", () => {
  for (const field of ["sessionMs", "planMs", "choreographyMs", "taskCardsMs", "assemblyMs", "totalMs"]) {
    assert.match(sequenceServer, new RegExp(`${field}:`));
  }
  assert.match(sequenceServer, /measured\(\(\) => getAtlasSession\(\)\)/);
  assert.match(sequenceServer, /measured\(\(\) => readWorkerSelfDayPlanForTarget/);
  assert.match(sequenceServer, /measured\(\(\) => readWorkerDayChoreographyForTarget/);
  assert.match(sequenceServer, /measured\(\(\) => readWorkerDayOperationalTaskCards/);
  assert.match(sequenceServer, /Atlas Worker Day sequence timing/);
});

test("timing instrumentation remains server-only and does not alter the Worker Day API response", () => {
  assert.doesNotMatch(route, /sessionMs|planMs|choreographyMs|taskCardsMs|assemblyMs|totalMs/);
  assert.doesNotMatch(sequenceServer, /farmId.*timing|membershipId.*timing|displayName.*timing/);
  assert.match(route, /return privateJson\(\{ ok: true, date, \.\.\.result \}\)/);
});
