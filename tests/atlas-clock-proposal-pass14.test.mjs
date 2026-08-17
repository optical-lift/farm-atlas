import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const legacyProposal = read("lib/atlas/clock-proposal.ts");
const serverProposal = read("lib/atlas/clock-server-proposal.ts");
const orchestrator = read("components/atlas/clock/clock-orchestrator.tsx");
const timeline = read("components/atlas/clock/clock-timeline-v2.tsx");
const unplaced = read("components/atlas/clock/clock-unplaced-v2.tsx");

test("proposal calculation remains presentation-only and server chronology is the current authority", () => {
  assert.match(serverProposal, /buildAtlasClockProposalFromChronology/);
  assert.match(serverProposal, /proposal/);
  assert.doesNotMatch(serverProposal, /fetch\s*\(/);
  assert.doesNotMatch(serverProposal, /\.from\s*\(/);
  assert.doesNotMatch(serverProposal, /\.rpc\s*\(/);
  assert.doesNotMatch(serverProposal, /POST/);
  assert.match(legacyProposal, /planning_default/);
});

test("server proposal adapter preserves chronology constraints and unresolved work", () => {
  assert.match(serverProposal, /entry\.chronologyState === "proposed"/);
  assert.match(serverProposal, /awaiting_day_shape/);
  assert.match(serverProposal, /blocked_policy_conflict/);
  assert.match(serverProposal, /unplaced_no_lawful_interval/);
  assert.match(serverProposal, /clockLocalMinuteOfDay/);
});

test("only Owner can open server-proposed Clock geometry and proposals remain presentation-only", () => {
  assert.match(orchestrator, /const serverProposal=useMemo\(\(\)=>buildAtlasClockProposalFromChronology\(committed,chronology\)/);
  assert.match(orchestrator, /const proposal=useMemo\(\(\)=>canManage&&proposalOpen\?serverProposal/);
  assert.match(orchestrator, /item\.kind !== "potential_task"/);
  assert.match(orchestrator, /ClockPlanBar/);
  assert.doesNotMatch(orchestrator, /buildAtlasClockProposal\(/);
  assert.doesNotMatch(orchestrator, /\/api\/atlas\/owner-day-task-time/);
  assert.doesNotMatch(orchestrator, /\/api\/atlas\/owner-day-task-duration/);
});

test("purple proposed times share the Clock rail without becoming committed white placements", () => {
  assert.match(timeline, /data-clock-proposed-time="true"/);
  assert.match(timeline, /White = committed · purple = proposed/);
  assert.match(timeline, /Atlas proposes/);
  assert.match(timeline, /timingClass:"potential"/);
  assert.doesNotMatch(serverProposal, /ClockOwnerControls/);
});

test("tasks with proposed geometry leave the duplicate Unplaced list while unresolved work stays explicit", () => {
  assert.match(unplaced, /proposedTaskIds\?\.has\(item\.id\)/);
  assert.match(unplaced, /Still unplaced/);
  assert.match(unplaced, /data-clock-proposal-unresolved="true"/);
  assert.match(unplaced, /Atlas left unplaced/);
});
