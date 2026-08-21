import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harvestSource = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const harvestStyles = readFileSync("app/owner/task-card-lab/harvest-card-specimen.module.css", "utf8");
const frameSource = readFileSync("components/atlas/task-card-frame.tsx", "utf8");
const frameStyles = readFileSync("components/atlas/task-card-frame.module.css", "utf8");
const editorFrame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const editorSource = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");

test("Task Card Editor renders the dedicated Harvest specimen", () => {
  assert.match(editorSource, /import HarvestCardSpecimen from "\.\/HarvestCardSpecimen"/);
  assert.match(editorSource, /index === 4[\s\S]*<HarvestCardSpecimen \/>/);
});

test("Harvest uses shared production task chrome with a current-zone subtitle and no hardcoded schedule copy", () => {
  assert.match(harvestSource, /<DominionCardFrame family="Harvest" title="Harvest Stems" subtitle=\{zones\.join\(" · "\)\}>/);
  assert.match(editorFrame, /@\/components\/atlas\/task-card-frame/);
  assert.match(frameSource, /className=\{styles\.familyRow\}/);
  assert.match(frameStyles, /\.familyRow > span \{[\s\S]*color: #858bb8/);
  assert.doesNotMatch(harvestSource, /Thursday Harvest/);
  assert.doesNotMatch(harvestSource, /Thursday morning/);
  assert.doesNotMatch(harvestSource, />Elm Farm</);
});

test("Harvest season pulse uses last round, this round, and next watch", () => {
  assert.match(harvestSource, /Last round/);
  assert.match(harvestSource, /This round/);
  assert.match(harvestSource, /Next watch/);
  assert.match(harvestSource, /Harvest season pulse/);
});

test("every harvestable crop row owns a quiet half-bucket counter", () => {
  assert.match(harvestSource, /function CropRow/);
  assert.match(harvestSource, /bucketHalves/);
  assert.match(harvestSource, /½ bucket · 10 stems/);
  assert.match(harvestSource, />\s*−\s*<\/button>/);
  assert.match(harvestSource, />\s*\+\s*<\/button>/);
  assert.doesNotMatch(harvestSource, /−½/);
  assert.doesNotMatch(harvestSource, /\+½/);
  assert.match(harvestStyles, /\.bucketCounter button \{[\s\S]*border: 0;[\s\S]*background: transparent/);
  assert.match(harvestStyles, /\.bucketCounter strong \{[\s\S]*border: 1px solid/);
});

test("crop name and bed quietly toggle an inline drawer with only real alternate outcomes", () => {
  assert.match(harvestSource, /className=\{styles\.cropIdentity\}/);
  assert.match(harvestSource, /aria-expanded=\{drawerOpen\}/);
  assert.match(harvestSource, /setDrawerOpen\(\(current\) => !current\)/);
  assert.match(harvestSource, /What happened\?/);
  assert.match(harvestSource, /Nothing ready/);
  assert.match(harvestSource, /Deadheaded/);
  assert.match(harvestSource, /Crop exhausted/);
  assert.doesNotMatch(harvestSource, /Harvested/);
  assert.doesNotMatch(harvestSource, /Left for later/);
  assert.doesNotMatch(harvestSource, /drawerCue/);
  assert.doesNotMatch(harvestSource, /⌄/);
  assert.doesNotMatch(harvestSource, /•••/);
  assert.match(harvestStyles, /\.outcomeGrid \{[\s\S]*repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(harvestStyles, /\.exceptionPanel \{[\s\S]*grid-column: 1 \/ -1/);
});

test("shared production chrome owns the ordinary Done and Unfinished footer", () => {
  assert.match(frameSource, />Done<\/button>/);
  assert.match(frameSource, />Unfinished<\/button>/);
  assert.doesNotMatch(harvestSource, /Mock only/);
  assert.doesNotMatch(harvestSource, /fetch\s*\(/);
  assert.doesNotMatch(harvestSource, /supabase/i);
});
