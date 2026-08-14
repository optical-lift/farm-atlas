import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const proposal = read("lib/atlas/clock-proposal.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const unplaced = read("components/atlas/clock/clock-unplaced-v2.tsx");

test("Pass 14 proposes time for committed Day work without creating another scheduler", () => {
  assert.match(proposal, /buildClockTaskRanges/);
  assert.match(proposal, /allowPrivateEstimate: true/);
  assert.match(proposal, /plannedDurationMinutes/);
  assert.match(proposal, /estimatedMinutes/);
  assert.match(proposal, /planning_default/);
  assert.doesNotMatch(proposal, /fetch\s*\(/);
  assert.doesNotMatch(proposal, /\.from\s*\(/);
  assert.doesNotMatch(proposal, /\.rpc\s*\(/);
  assert.doesNotMatch(proposal, /POST/);
});

test("proposal geometry obeys mobility constraints and leaves impossible work unresolved", () => {
  for (const field of ["fixedLocalTime", "windowStartAt", "windowEndAt", "anchorTaskId", "anchorRelation", "minimumGapMinutes"]) assert.match(proposal, new RegExp(field));
  assert.match(proposal, /No open span currently fits inside the recorded execution window/);
  assert.match(proposal, /leaving this work unplaced/);
  assert.match(proposal, /constraintRank/);
  assert.match(proposal, /reservations/);
});

test("only Owner can open the proposed Clock and proposals remain presentation-only", () => {
  assert.match(orchestrator, /canManage&&proposalOpen\?buildAtlasClockProposal\(committed,\{reservations:dayReservations\}\)/);
  assert.match(orchestrator, /item\.kind !== "potential_task"/);
  assert.match(orchestrator, /nothing changes Anna's Clock until Commit plan/i);
  assert.match(orchestrator, /Plan this Clock/);
  assert.doesNotMatch(orchestrator, /\/api\/atlas\/owner-day-task-time/);
  assert.doesNotMatch(orchestrator, /\/api\/atlas\/owner-day-task-duration/);
});

test("purple proposed times share the Clock rail without becoming committed white placements", () => {
  assert.match(timeline, /data-clock-proposed-time="true"/);
  assert.match(timeline, /White = committed · purple = proposed/);
  assert.match(timeline, /Atlas proposes/);
  assert.match(timeline, /timingClass:"potential"/);
  assert.doesNotMatch(proposal, /ClockOwnerControls/);
});

test("tasks with proposed geometry leave the duplicate Unplaced list while unresolved work stays explicit", () => {
  assert.match(unplaced, /proposedTaskIds\?\.has\(item\.id\)/);
  assert.match(unplaced, /Still unplaced/);
  assert.match(unplaced, /data-clock-proposal-unresolved="true"/);
  assert.match(unplaced, /Atlas left unplaced/);
});
