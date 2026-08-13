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
const planGate = read("components/atlas/owner-day-plan-gate.tsx");

test("Day sequence defines one typed read model for committed work, potential work, and cues", () => {
  assert.match(sequence, /kind: "committed_task"/);
  assert.match(sequence, /kind: "potential_task"/);
  assert.match(sequence, /kind: "cue"/);
  assert.match(sequence, /contractVersion: "worker_day_sequence_v1"/);
  assert.match(sequence, /commitmentState: "committed"/);
  assert.match(sequence, /commitmentState: "potential"/);
});

test("Pass 3 deterministically resolves first-open, task-anchored, and timed cue positions", () => {
  assert.match(sequence, /positionBasis: "first_open"/);
  assert.match(sequence, /cue\.anchorKind === "at_time"/);
  assert.match(sequence, /cue\.anchorKind === "before_task" \? -0\.01 : 0\.01/);
  assert.match(sequence, /timeZone: "America\/Chicago"/);
  assert.match(sequence, /positionBasis: "timed_estimate"/);
  assert.match(sequence, /items: \[\.\.\.workItems, \.\.\.cueItems\]\.sort\(sortSequenceItems\)/);
});

test("timed cue placement uses the existing work order plus expected duration instead of inventing task start times", () => {
  assert.match(sequence, /estimatedMinutes \?\? 30/);
  assert.match(sequence, /totalMinutes/);
  assert.match(sequence, /target = ratio \* totalMinutes/);
  assert.match(sequence, /orderBetween\(previous, next\)/);
  assert.doesNotMatch(sequence, /taskStartTime/);
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

test("Owner planning consumes the shared Day sequence and can project against live draft geometry", () => {
  assert.match(projection, /\/api\/atlas\/worker-day-sequence\?date=/);
  assert.match(projection, /data-owner-potential-day-card/);
  assert.match(projection, /data-owner-day-sequence-cue/);
  assert.match(projection, /positionResolved/);
  assert.match(projection, /resolved", "dismissed", "stale/);
  assert.match(projection, /effectivePlacement/);
  assert.match(projection, /ownerDraftWindow/);
  assert.match(projection, /ownerDraftOrder/);
  assert.doesNotMatch(projection, /\/api\/atlas\/worker-day-plan\?date=/);
  assert.doesNotMatch(projection, /method:\s*"POST"/);
});

test("Pass 4 keeps live cues in normal Owner Day and Pass 5 adds purple only while planning", () => {
  assert.match(projection, /function visibleSequenceItems\(items: SequenceItem\[\], planningActive: boolean, hiddenPotential: Set<string>\)/);
  assert.match(projection, /if \(item\.kind === "cue"\) return isVisibleCue\(item\)/);
  assert.match(projection, /planningActive && item\.projectionEligible/);
  assert.match(projection, /if \(!dateIso\) return/);
  assert.match(planGate, /<OwnerInterleavedDayProjection planningActive=\{open\} \/>/);
  assert.match(projection, /data-owner-day-normal-sequence-cues/);
});

test("task-anchored cues stay attached to a white task while the inline draft reorders it", () => {
  assert.match(projection, /item\.anchorTaskId/);
  assert.match(projection, /item\.anchorKind === "before_task"/);
  assert.match(projection, /item\.anchorKind === "after_task"/);
  assert.match(projection, /insertAdjacentElement\("afterend", host\)/);
  assert.match(projection, /atlas-owner-day-draft-layout/);
});
