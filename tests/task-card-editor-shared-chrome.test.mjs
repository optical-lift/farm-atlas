import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const frame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const venue = readFileSync("app/owner/task-card-lab/VenueCardSpecimen.tsx", "utf8");
const sow = readFileSync("app/owner/task-card-lab/SowCardSpecimen.tsx", "utf8");
const weed = readFileSync("app/owner/task-card-lab/WeedCardSpecimen.tsx", "utf8");
const mow = readFileSync("app/owner/task-card-lab/MowCardSpecimen.tsx", "utf8");
const harvest = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const remaining = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");

test("shared Dominion frame owns universal family title place and completion chrome", () => {
  assert.match(frame, /<span>\{family\}<\/span>/);
  assert.match(frame, /<h2>\{title\}<\/h2>/);
  assert.match(frame, /subtitle \? <p className=\{styles\.subtitle\}>\{subtitle\}<\/p> : null/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("designed card shells restore their place or zone subtitles", () => {
  assert.match(venue, /title="Tidy Community Thursday" subtitle="Elm Farm"/);
  assert.match(venue, /title="Prep Community Thursday" subtitle="Elm Farm"/);
  assert.match(venue, /title="Host Community Thursday" subtitle="Elm Farm"/);
  assert.match(sow, /title="Field Row 6" subtitle="Field Rows"/);
  assert.match(weed, /title="Field Row 13" subtitle="Field Rows"/);
  assert.match(mow, /title="U-Pick Walkways" subtitle="U-Pick"/);
  assert.match(harvest, /title="Harvest Stems" subtitle=\{zones\.join\(" · "\)\}/);
  assert.match(remaining, /title="Move 15 Zinnias" subtitle="Curve Garden"/);
});

test("crop-cycle actions share one bed wrapper rather than their own task shells", () => {
  assert.match(weed, /function CropCycleBedCard/);
  assert.match(weed, /family="Weed"/);
  assert.match(weed, /family="Irrigation"/);
  assert.match(weed, /family="Check"/);
  assert.match(weed, /family="Clear \/ Turn over"/);
  assert.match(weed, /Field Row 13 crop-cycle trail/);
});

test("approved family interiors survive the shared shell and crop cycle refactor", () => {
  assert.match(venue, /Tidy → Prep → Host → Reset/);
  assert.match(venue, /Turn on the ice maker/);
  assert.match(sow, /Projections/);
  assert.match(sow, /Seed estimate/);
  assert.match(weed, /Bed map/);
  assert.match(weed, /How’d we do\?/);
  assert.match(weed, /Field Rows hose line/);
  assert.match(weed, /Did enough emerge to keep this planting\?/);
  assert.match(mow, /Mow height/);
  assert.match(mow, /3 in/);
  assert.match(mow, /Riding mower/);
  assert.match(harvest, /Harvest season pulse/);
  assert.match(remaining, /Water immediately/);
});

test("legacy per-family completion chrome remains removed", () => {
  assert.doesNotMatch(venue, /Tidy complete|Prep complete|Event open/);
  assert.doesNotMatch(sow, /Sowing complete|Partly sown/);
  assert.doesNotMatch(weed, /Done weeding today|Bed cleared for next crop|Blocked/);
  assert.doesNotMatch(mow, /Mowed to 3 in|Blocked/);
});
