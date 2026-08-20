import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harvestSource = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const editorSource = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Task Card Editor renders the dedicated Harvest specimen", () => {
  assert.match(editorSource, /import HarvestCardSpecimen from "\.\/HarvestCardSpecimen"/);
  assert.match(editorSource, /index === 4[\s\S]*<HarvestCardSpecimen \/>/);
});

test("Harvest is one weekly multi-crop round", () => {
  assert.match(harvestSource, /Thursday Harvest/);
  assert.match(harvestSource, /weekly round/);
  assert.match(harvestSource, /Ready to harvest/);
  assert.match(harvestSource, /Berry Walk/);
  assert.match(harvestSource, /Field Rows/);
  assert.doesNotMatch(harvestSource, /Same crop · same daily total/);
  assert.doesNotMatch(harvestSource, /two doors into one crop-cycle record/);
});

test("Harvest season pulse uses last round, this round, and next watch", () => {
  assert.match(harvestSource, /Last round/);
  assert.match(harvestSource, /This round/);
  assert.match(harvestSource, /Next watch/);
  assert.match(harvestSource, /Harvest season pulse/);
  assert.doesNotMatch(harvestSource, /Sown/);
  assert.doesNotMatch(harvestSource, /Harvest again/);
});

test("every harvestable crop row owns its own half-bucket counter", () => {
  assert.match(harvestSource, /function CropRow/);
  assert.match(harvestSource, /bucketHalves/);
  assert.match(harvestSource, /½ bucket · 10 stems/);
  assert.match(harvestSource, /setBucketHalves\(\(current\) => current \+ 1\)/);
  assert.match(harvestSource, /Math\.max\(0, current - 1\)/);
});

test("nonstandard Harvest outcomes stay behind the per-crop demure drawer", () => {
  assert.match(harvestSource, /exceptionDrawer/);
  assert.match(harvestSource, /What happened\?/);
  assert.match(harvestSource, /Harvested/);
  assert.match(harvestSource, /Nothing ready/);
  assert.match(harvestSource, /Left for later/);
  assert.match(harvestSource, /Deadheaded/);
  assert.match(harvestSource, /Crop exhausted/);
});

test("Harvest ends with the ordinary task completion controls and no instructional prose", () => {
  assert.match(harvestSource, />Done<\/button>/);
  assert.match(harvestSource, />Unfinished<\/button>/);
  assert.doesNotMatch(harvestSource, /Mock only/);
  assert.doesNotMatch(harvestSource, /Worker/);
  assert.doesNotMatch(harvestSource, /Atlas keeps/);
  assert.doesNotMatch(harvestSource, /For an annual crop/);
  assert.doesNotMatch(harvestSource, /Perennial rule/);
  assert.doesNotMatch(harvestSource, /fetch\s*\(/);
  assert.doesNotMatch(harvestSource, /supabase/i);
});
