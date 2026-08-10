import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
const priority = readFileSync(new URL("../lib/atlas/projects-home-priority.ts", import.meta.url), "utf8");

test("Owner Projects home exposes one canonical highest-consequence Move before farm lanes", () => {
  assert.match(page, /readAtlasProjectsHomePriority\(home, session\.userId\)/);
  assert.match(page, /<PrimaryBlocker priority=/);
  assert.match(page, /Needs you now/);
  assert.match(page, /\/task-focus\/\$\{encodeURIComponent\(blocker\.taskId\)\}/);
  assert.match(page, /other .*thing needs|other .*things need/);
  assert.doesNotMatch(page, /home\.attention\.map/);
  assert.doesNotMatch(page, /AtlasMetricStrip/);
});

test("Projects home groups compact Worlds by farm and uses Atlas trail lines and dots", () => {
  assert.match(page, /FarmHomeLane/);
  assert.match(page, /atlas-home-world-grid/);
  assert.match(page, /atlas-home-world-node::before/);
  assert.match(page, /atlas-home-world-grid::before/);
  assert.match(page, /MiniRealityTrail/);
  assert.match(page, /atlas-mini-reality-node/);
  assert.match(page, /No active Worlds yet/);
  assert.match(page, /CrossFarmHomeLane/);
});

test("project blocker ranking is consequence-first and treats current completion-gated servings as real blockers", () => {
  assert.match(priority, /downstreamUnlockCount \* 18/);
  assert.match(priority, /blockedMembershipCount \* 22/);
  assert.match(priority, /currentQueueServing\) score \+= 28/);
  assert.match(priority, /release_queue_policy === "completion_gated_serial"/);
  assert.match(priority, /completion_gate_serving/);
  assert.match(priority, /hardDate[\s\S]*daysToTarget/);
  assert.match(priority, /current completion-gated project serving is itself a blocker/);
  assert.match(priority, /task\.status !== "open"/);
  assert.match(priority, /ownerActionable/);
  assert.match(priority, /rootProjectIds/);
});

test("Projects priority reads dependency context through the governed Atlas RPC instead of exposing prerequisite rows", () => {
  assert.match(priority, /task_move_context_batch_v1/);
  assert.match(priority, /\.rpc\("task_move_context_batch_v1"/);
  assert.match(priority, /moveContexts/);
  assert.doesNotMatch(priority, /\.from\("task_prerequisites"\)/);
});

test("Projects priority uses the farms' Central operating date instead of Vercel UTC", () => {
  assert.match(priority, /timeZone: "America\/Chicago"/);
  assert.match(priority, /today: atlasOperatingDate\(\)/);
  assert.doesNotMatch(priority, /getTimezoneOffset\(\)/);
});
