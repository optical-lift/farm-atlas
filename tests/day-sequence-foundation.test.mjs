import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const sequence = read("lib/atlas/day-sequence.ts");
const sequenceServer = read("lib/atlas/worker-day-sequence-server.ts");
const route = read("app/api/atlas/worker-day-sequence/route.ts");
const projection = read("components/atlas/owner-interleaved-day-projection.tsx");

test("Day sequence defines one typed read model for committed work, potential work, and cues", () => {
  assert.match(sequence, /kind: "committed_task"/);
  assert.match(sequence, /kind: "potential_task"/);
  assert.match(sequence, /kind: "cue"/);
  assert.match(sequence, /contractVersion: "worker_day_sequence_v1"/);
  assert.match(sequence, /commitmentState: "committed"/);
  assert.match(sequence, /commitmentState: "potential"/);
});

test("Pass 2 does not pretend cue positions are solved before deterministic anchor rules exist", () => {
  assert.match(sequence, /dayWindow: null/);
  assert.match(sequence, /sequenceOrder: null/);
  assert.match(sequence, /positionResolved: false/);
  assert.match(sequence, /Pass 3 owns the deterministic before\/after\/time insertion rules/);
});

test("the sequence reader combines existing plan and choreography truth without creating another write path", () => {
  assert.match(sequenceServer, /readOwnerWorkerDayPlan/);
  assert.match(sequenceServer, /readOwnerWorkerDayChoreography/);
  assert.match(sequenceServer, /assembleWorkerDaySequence/);
  assert.match(sequenceServer, /sameTarget/);
  assert.doesNotMatch(sequenceServer, /\.rpc\(/);
  assert.doesNotMatch(sequenceServer, /\.from\(/);
});

test("the Day sequence API is private read-only infrastructure for Day and future Clock", () => {
  assert.match(route, /worker-day-sequence-v1/);
  assert.match(route, /readOwnerWorkerDaySequence/);
  assert.match(route, /export async function GET/);
  assert.doesNotMatch(route, /export async function POST/);
  assert.doesNotMatch(route, /export async function PATCH/);
  assert.doesNotMatch(route, /export async function DELETE/);
});

test("Pass 1 projection remains intact while Pass 2 establishes the shared seam underneath it", () => {
  assert.match(projection, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.match(projection, /data-owner-potential-day-card="true"/);
  assert.match(projection, /projection/i);
  assert.doesNotMatch(projection, /method:\s*"POST"/);
});
