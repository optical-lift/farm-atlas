import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const planServer = readFileSync(join(root, "lib/atlas/worker-day-plan-server.ts"), "utf8");
const sequenceServer = readFileSync(join(root, "lib/atlas/worker-day-sequence-server.ts"), "utf8");
const projectionClient = readFileSync(join(root, "lib/atlas/worker-day-projection-client.ts"), "utf8");
const serverProposal = readFileSync(join(root, "lib/atlas/clock-server-proposal.ts"), "utf8");
const orchestrator = readFileSync(join(root, "components/atlas/clock/clock-orchestrator.tsx"), "utf8");

test("clockTimeline survives plan normalization and enters the runtime sequence", () => {
  assert.match(planServer, /clockTimeline: AtlasWorkerDayChronology \| null/i);
  assert.match(planServer, /normalizeAtlasWorkerDayChronology\(row\.clockTimeline\)/i);
  assert.match(sequenceServer, /clockTimeline: plan\.clockTimeline/i);
  assert.match(projectionClient, /clockTimeline: AtlasWorkerDayChronology \| null/i);
});

test("Clock proposal geometry is adapted from the server chronology", () => {
  assert.match(serverProposal, /buildAtlasClockProposalFromChronology/i);
  assert.match(serverProposal, /entry\.chronologyState === "proposed"/i);
  assert.match(serverProposal, /clockLocalMinuteOfDay\(entry\.startsAt, timeZone\)/i);
  assert.match(serverProposal, /awaiting_day_shape/i);
  assert.match(serverProposal, /unplaced_no_lawful_interval/i);
});

test("Clock surface no longer calls the legacy client auto-scheduler", () => {
  assert.match(orchestrator, /buildAtlasClockProposalFromChronology/i);
  assert.match(orchestrator, /server chronology owns proposal geometry/i);
  assert.doesNotMatch(orchestrator, /buildAtlasClockProposal\(/i);
  assert.match(orchestrator, /dayShapeReady=chronology\?\.dayShape\.state==="resolved"/i);
});

test("Farm Hand never receives proposal geometry as authoritative Clock placement", () => {
  assert.match(orchestrator, /const proposal=useMemo\(\(\)=>canManage&&proposalOpen\?serverProposal/i);
  assert.match(orchestrator, /proposalOpen/i);
  assert.match(serverProposal, /proposal/i);
});
