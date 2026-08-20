import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harvestSource = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const editorSource = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Task Card Editor renders the dedicated Harvest specimen", () => {
  assert.match(editorSource, /import HarvestCardSpecimen from "\.\/HarvestCardSpecimen"/);
  assert.match(editorSource, /index === 4[\s\S]*<HarvestCardSpecimen \/>/);
});

test("Harvest specimen keeps one crop truth shared with the Harvest board", () => {
  assert.match(harvestSource, /Harvest board/);
  assert.match(harvestSource, /Same crop · same daily total/);
  assert.match(harvestSource, /two doors into one crop-cycle record/);
  assert.match(harvestSource, /Cumulative for this bed \/ crop/);
});

test("Harvest quantity uses the settled half-bucket daily-total grammar", () => {
  assert.match(harvestSource, /½ bucket = 10 stems · 1 bucket = 20 stems/);
  assert.match(harvestSource, /const stems = bucketHalves \* 10/);
  assert.match(harvestSource, /setBucketHalves\(\(current\) => current \+ 1\)/);
  assert.match(harvestSource, /setBucketHalves\(\(current\) => Math\.max\(0, current - 1\)\)/);
});

test("Harvest zero-quantity outcomes remain distinct farmer decisions", () => {
  assert.match(harvestSource, /Nothing ready/);
  assert.match(harvestSource, /Left for later/);
  assert.match(harvestSource, /Deadheaded/);
  assert.match(harvestSource, /Harvested needs at least ½ bucket/);
});

test("crop exhaustion is visually and semantically separate from ordinary Harvest results", () => {
  assert.match(harvestSource, /Major crop judgment/);
  assert.match(harvestSource, /Mark crop exhausted/);
  assert.match(harvestSource, /For an annual crop/);
  assert.match(harvestSource, /Perennial rule/);
  assert.match(harvestSource, /instead of annual turnover/);
});

test("Harvest specimen exposes backward logging without becoming a production writer", () => {
  assert.match(harvestSource, /Log an earlier harvest/);
  assert.match(harvestSource, /evidence-entry time/);
  assert.doesNotMatch(harvestSource, /fetch\s*\(/);
  assert.doesNotMatch(harvestSource, /supabase/i);
});
