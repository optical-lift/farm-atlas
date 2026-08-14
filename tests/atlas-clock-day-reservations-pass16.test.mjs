import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const reservations = read("lib/atlas/clock-reservations.ts");
const proposal = read("lib/atlas/clock-proposal.ts");
const draft = read("lib/atlas/clock-plan-draft.ts");
const editor = read("components/atlas/clock/use-clock-plan-editor.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");
const planningTimeline = read("components/atlas/clock/clock-planning-timeline.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const route = read("app/api/atlas/owner-clock-plan-commit/route.ts");

test("Pass 16 introduces non-task day reservations without creating another scheduler", () => {
  assert.match(reservations, /"timed_cue" \| "routine" \| "meal" \| "external_commitment"/);
  assert.match(reservations, /AtlasClockReservationKind = "point" \| "span"/);
  assert.match(reservations, /buildAtlasClockReservations/);
  assert.doesNotMatch(reservations, /fetch\s*\(/);
  assert.doesNotMatch(reservations, /\.rpc\s*\(/);
  assert.doesNotMatch(reservations, /supabase/i);
  assert.doesNotMatch(reservations, /due_date|record_task_transition|atlas\.tasks/i);
});

test("only real at-time cues become point reservations", () => {
  assert.match(reservations, /cue\.anchorKind === "at_time"/);
  assert.match(reservations, /cue\.positionResolved/);
  assert.match(reservations, /hiddenCueStatuses/);
  assert.match(reservations, /kind: "point"/);
  assert.match(reservations, /source: "timed_cue"/);
});

test("a point reservation blocks crossing through the cue but permits a task to start or end on it", () => {
  assert.match(reservations, /startMinute < reservation\.startMinute && endMinute > reservation\.startMinute/);
  assert.doesNotMatch(reservations, /startMinute <= reservation\.startMinute && endMinute >= reservation\.startMinute/);
});

test("Atlas proposed Clock geometry searches around real day reservations", () => {
  assert.match(proposal, /options: \{ reservations\?: AtlasClockReservation\[\] \} = \{\}/);
  assert.match(proposal, /atlasClockReservationConflicts/);
  assert.match(proposal, /options\.reservations \?\? \[\]/);
  assert.match(proposal, /conflictsAny/);
  assert.match(proposal, /firstFree/);
  assert.match(proposal, /lastFree/);
  assert.match(proposal, /day reservation/);
});

test("manual Owner moves across a reservation become an explicit override warning", () => {
  assert.match(draft, /"reservation"/);
  assert.match(draft, /atlasClockReservationConflicts/);
  assert.match(draft, /crosses the real day reservation/);
  assert.match(editor, /reservations: AtlasClockReservation\[\]/);
  assert.match(editor, /buildAtlasClockDraftCommitChanges\(blocks, input\.reservations\)/);
  assert.match(route, /"reservation"/);
  assert.match(editor, /unresolvedWarningCount/);
});

test("Owner proposal wiring uses timed cues and projected commitments while Farm Hand privacy stays intact", () => {
  assert.match(orchestrator, /projection\?\.reservations\?\?\[\]/);
  assert.match(orchestrator, /buildAtlasClockReservations\(\{timedCues,commitments,timeZone:DEFAULT_ATLAS_FARM_TIME_ZONE\}\)/);
  assert.match(orchestrator, /buildAtlasClockProposal\(committed,\{reservations:dayReservations\}\)/);
  assert.match(orchestrator, /reservations:dayReservations/);
  assert.match(orchestrator, /item\.kind !== "potential_task"/);
  assert.doesNotMatch(reservations, /readiness|doneDisabled|blocker/i);
  assert.doesNotMatch(draft, /readiness|doneDisabled|blocker/i);
});

test("Clock surfaces mark day reservations without turning them into task blocks", () => {
  assert.match(planningTimeline, /data-clock-day-reservation="point"/);
  assert.match(timeline, /data-clock-day-reservation="point"/);
  assert.match(planningTimeline, /data-clock-timed-cue="true"/);
  assert.match(timeline, /data-clock-timed-cue="true"/);
  assert.match(planningTimeline, /data-clock-non-task="true"/);
  assert.match(timeline, /data-clock-non-task="true"/);
  assert.doesNotMatch(reservations, /committed_task/);
});
