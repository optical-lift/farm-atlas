import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const projection = read("lib/atlas/day-projection.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const ownerReader = read("components/atlas/clock/clock-owner-reader.ts");
const workerReader = read("components/atlas/clock/clock-worker-reader.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");

test("Pass 16 gives Worker Day an explicit projection identity and revision boundary", () => {
  assert.match(projection, /contractVersion: "atlas_projection_identity_v1"/);
  assert.match(projection, /projectionType: "worker_day"/);
  assert.match(projection, /farmId: string/);
  assert.match(projection, /membershipId: string/);
  assert.match(projection, /serviceDate: string/);
  assert.match(projection, /lens: AtlasWorkerDayProjectionLens/);
  assert.match(projection, /revision: string/);
  assert.match(projection, /\["worker_day", input\.farmId, input\.membershipId, input\.serviceDate, input\.lens\]/);
});

test("projection identity preserves the role lens instead of collapsing Owner and Farm Hand state", () => {
  assert.match(projection, /"operator_lens" \| "owner_direct" \| "worker_self"/);
  assert.match(projection, /lens: input\.lens/);
  assert.match(sequenceServer, /lens: planResult\.target\.source/);
  assert.match(workerReader, /lens: target\.source/);
});

test("projection revisions are deterministic fingerprints of identity plus sequence state", () => {
  assert.match(projection, /stableProjectionValue/);
  assert.match(projection, /Object\.entries\(value as Record<string, unknown>\)/);
  assert.match(projection, /\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(projection, /projectionFingerprint\(\{ identity, sequence: input\.sequence \}\)/);
  assert.doesNotMatch(projection, /Date\.now|new Date|randomUUID|Math\.random/);
});

test("the owner worker-day read returns the projection envelope while preserving the sequence compatibility seam", () => {
  assert.match(sequenceServer, /const projection = buildAtlasWorkerDayProjection/);
  assert.match(sequenceServer, /projection,/);
  assert.match(sequenceServer, /sequence: projection\.sequence/);
  assert.match(sequenceServer, /projection: null, sequence: null/);
});

test("Owner and Farm Hand Clock readers converge on the same projection contract", () => {
  assert.match(ownerReader, /AtlasWorkerDayProjection/);
  assert.match(ownerReader, /readOwnerClockProjection/);
  assert.match(ownerReader, /body\.projection/);
  assert.match(workerReader, /buildAtlasWorkerDayProjection/);
  assert.match(workerReader, /readWorkerClockProjection/);
  assert.match(workerReader, /target\?\.farmId/);
  assert.match(workerReader, /target\.membershipId/);
});

test("Clock stores the projection as its loaded environment and derives sequence from it", () => {
  assert.match(orchestrator, /useState<AtlasWorkerDayProjection\|null>/);
  assert.match(orchestrator, /const sequence=projection\?\.sequence\?\?null/);
  assert.match(orchestrator, /readOwnerClockProjection/);
  assert.match(orchestrator, /readWorkerClockProjection/);
  assert.match(orchestrator, /setProjection\(value\.projection\)/);
  assert.doesNotMatch(orchestrator, /setSequence\(/);
});
