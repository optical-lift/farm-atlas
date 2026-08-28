import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/atlas/weed-card/route.ts", import.meta.url), "utf8");

test("Weed Task Focus rail shows last move, current move, and two downstream moves", () => {
  assert.match(route, /dependent_task_ids/);
  assert.match(route, /dependent_task_labels/);
  assert.match(route, /latestTrailEvent\(card\.bedTrail\)/);
  assert.match(route, /eventKind: `Now · \$\{currentAction\}`/);
  assert.match(route, /eventKind: `Next · \$\{action\}`/);
  assert.match(route, /\.\.\.dependencyTrail\.slice\(0, 2\)/);
  assert.match(route, /bedTrail: workflowTrail\.length \? workflowTrail : card\.bedTrail/);
  assert.match(route, /one completed move behind, the move in hand, and at most two moves\/unlocks ahead/);
});

test("mixed perennial beds get a community summary instead of a fabricated primary crop", () => {
  assert.match(route, /function perennialCohorts/);
  assert.match(route, /function communityCategory/);
  assert.match(route, /function communitySummary/);
  assert.match(route, /labels\.length === 1 \? "planting" : "plantings"/);
  assert.match(route, /mainCropLabel: mainCropLabel \|\| communityLabel/);
  assert.doesNotMatch(route, /infer a primary crop from overlapping active cycles/);
});
