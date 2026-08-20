import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harvestSource = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const harvestStyles = readFileSync("app/owner/task-card-lab/harvest-card-specimen.module.css", "utf8");
const editorSource = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Task Card Editor renders the dedicated Harvest specimen", () => {
  assert.match(editorSource, /import HarvestCardSpecimen from "\.\/HarvestCardSpecimen"/);
  assert.match(editorSource, /index === 4[\s\S]*<HarvestCardSpecimen \/>/);
});

test("Harvest is one multi-crop round without a hardcoded weekday or farm subtitle", () => {
  assert.match(harvestSource, /Harvest Stems/);
  assert.match(harvestSource, /Ready to harvest/);
  assert.match(harvestSource, /Berry Walk/);
  assert.match(harvestSource, /Field Rows/);
  assert.doesNotMatch(harvestSource, /Thursday Harvest/);
  assert.doesNotMatch(harvestSource, /Thursday morning/);
  assert.doesNotMatch(harvestSource, />Elm Farm</);
  assert.doesNotMatch(harvestSource, /weekly round/);
});

test("Harvest season pulse uses last round, this round, and next watch", () => {
  assert.match(harvestSource, /Last round/);
  assert.match(harvestSource, /This round/);
  assert.match(harvestSource, /Next watch/);
  assert.match(harvestSource, /Harvest season pulse/);
  assert.doesNotMatch(harvestSource, /Sown/);
  assert.doesNotMatch(harvestSource, /Harvest again/);
});

test("every harvestable crop row owns its own half-bucket stepper", () => {
  assert.match(harvestSource, /function CropRow/);
  assert.match(harvestSource, /bucketHalves/);
  assert.match(harvestSource, /½ bucket · 10 stems/);
  assert.match(harvestSource, /−½/);
  assert.match(harvestSource, /\+½/);
  assert.match(harvestSource, /setBucketHalves\(\(current\) => current \+ 1\)/);
  assert.match(harvestSource, /Math\.max\(0, current - 1\)/);
  assert.match(harvestStyles, /background: rgba\(244, 239, 227, 0\.92\)/);
  assert.doesNotMatch(harvestStyles, /\.bucketCounter[^}]*rgba\(239, 237, 244/);
});

test("crop name and bed toggle the inline nonstandard-outcome drawer", () => {
  assert.match(harvestSource, /className=\{styles\.cropIdentity\}/);
  assert.match(harvestSource, /aria-expanded=\{drawerOpen\}/);
  assert.match(harvestSource, /setDrawerOpen\(\(current\) => !current\)/);
  assert.match(harvestSource, /What happened\?/);
  assert.match(harvestSource, /Harvested/);
  assert.match(harvestSource, /Nothing ready/);
  assert.match(harvestSource, /Left for later/);
  assert.match(harvestSource, /Deadheaded/);
  assert.match(harvestSource, /Crop exhausted/);
  assert.doesNotMatch(harvestSource, /•••/);
  assert.doesNotMatch(harvestStyles, /position: absolute;[\s\S]{0,180}exceptionPanel/);
  assert.match(harvestStyles, /\.exceptionPanel \{[\s\S]*grid-column: 1 \/ -1/);
});

test("Harvest ends with ordinary completion controls and no instructional prose", () => {
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
