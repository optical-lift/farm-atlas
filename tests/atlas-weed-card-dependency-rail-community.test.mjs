import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(new URL("../app/api/atlas/weed-card/route.ts", import.meta.url), "utf8");

test("Weed Task Focus rail prioritizes direct downstream tasks over old bed history", () => {
  assert.match(route, /dependent_task_ids/);
  assert.match(route, /dependent_task_labels/);
  assert.match(route, /eventKind: `Next · \$\{action\}`/);
  assert.match(route, /bedTrail: dependencyTrail\.length \? dependencyTrail : card\.bedTrail/);
  assert.match(route, /work that becomes executable/);
});

test("mixed perennial beds get a community summary instead of a fabricated primary crop", () => {
  assert.match(route, /function perennialCohorts/);
  assert.match(route, /function communityCategory/);
  assert.match(route, /function communitySummary/);
  assert.match(route, /labels\.length === 1 \? "planting" : "plantings"/);
  assert.match(route, /mainCropLabel: mainCropLabel \|\| communityLabel/);
  assert.doesNotMatch(route, /infer a primary crop from overlapping active cycles/);
});
