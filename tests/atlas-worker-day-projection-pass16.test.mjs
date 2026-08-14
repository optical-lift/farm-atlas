import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const projection = read("lib/atlas/day-projection.ts");
const projectionClient = read("lib/atlas/worker-day-projection-client.ts");
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
  assert.match(sequenceServer, /lens: target\.source/);
  assert.match(projectionClient, /projection: body\.projection/);
  assert.match(sequenceServer, /source: "worker_self"/);
});

test("projection revisions are deterministic fingerprints of identity, sequence, and real-day reservations", () => {
  assert.match(projection, /stableProjectionValue/);
  assert.match(projection, /Object\.entries\(value as Record<string, unknown>\)/);
  assert.match(projection, /\.sort\(\(\[left\], \[right\]\) => left\.localeCompare\(right\)\)/);
  assert.match(projection, /projectionFingerprint\(\{ identity, sequence: input\.sequence, reservations \}\)/);
  assert.match(projection, /reservations: AtlasDayReservation\[\]/);
  assert.doesNotMatch(projection, /Date\.now|new Date|randomUUID|Math\.random/);
});

test("the worker-day read returns the projection envelope while preserving the sequence compatibility seam", () => {
  assert.match(sequenceServer, /const projection = buildAtlasWorkerDayProjection/);
  assert.match(sequenceServer, /projection,/);
  assert.match(sequenceServer, /sequence: projection\.sequence/);
  assert.match(sequenceServer, /projection: null/);
  assert.match(sequenceServer, /sequence: null/);
});

test("Owner and Farm Hand reads converge on the shared server projection client", () => {
  assert.match(projectionClient, /readOwnerWorkerDayProjection/);
  assert.match(projectionClient, /body\.projection/);
  assert.match(projectionClient, /readWorkerSelfDayProjection/);
  assert.match(projectionClient, /readWorkerDaySequenceResponse/);
  assert.match(projectionClient, /\/api\/atlas\/worker-day-sequence/);
  assert.doesNotMatch(projectionClient, /buildAtlasWorkerDayProjection/);
  assert.doesNotMatch(projectionClient, /target\?\.farmId|target\.membershipId/);
  assert.match(ownerReader, /readOwnerWorkerDayProjection/);
  assert.match(workerReader, /readWorkerSelfDayProjection/);
});

test("Clock derives its sequence from the projection environment without a second sequence state", () => {
  assert.match(orchestrator, /useAtlasWorkerDayProjection\(dateIso\)/);
  assert.match(orchestrator, /const sequence=projection\?\.sequence\?\?null/);
  assert.doesNotMatch(orchestrator, /setSequence\(/);
  assert.doesNotMatch(orchestrator, /useState<AtlasWorkerDayProjection\|null>/);
});
