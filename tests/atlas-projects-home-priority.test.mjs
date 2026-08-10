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

test("project blocker ranking is consequence-first rather than overdue-task-first", () => {
  assert.match(priority, /downstreamUnlockCount \* 18/);
  assert.match(priority, /blockedMembershipCount \* 22/);
  assert.match(priority, /hardDate[\s\S]*daysToTarget/);
  assert.match(priority, /Ordinary overdue Owner chores never become the hero/);
  assert.match(priority, /task\.status !== "open"/);
  assert.match(priority, /ownerActionable/);
  assert.match(priority, /rootProjectIds/);
});
