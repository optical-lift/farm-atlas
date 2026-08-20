import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const frame = readFileSync("app/owner/task-card-lab/DominionCardFrame.tsx", "utf8");
const frameStyles = readFileSync("app/owner/task-card-lab/dominion-card-frame.module.css", "utf8");
const venue = readFileSync("app/owner/task-card-lab/VenueCardSpecimen.tsx", "utf8");
const sow = readFileSync("app/owner/task-card-lab/SowCardSpecimen.tsx", "utf8");
const weed = readFileSync("app/owner/task-card-lab/WeedCardSpecimen.tsx", "utf8");
const mow = readFileSync("app/owner/task-card-lab/MowCardSpecimen.tsx", "utf8");
const harvest = readFileSync("app/owner/task-card-lab/HarvestCardSpecimen.tsx", "utf8");
const remaining = readFileSync("app/owner/task-card-lab/RemainingDominionCardSpecimens.tsx", "utf8");

test("shared Dominion frame owns the approved card top and universal completion chrome", () => {
  assert.match(frame, /<span>\{family\}<\/span>/);
  assert.match(frame, /familyDetail \? <small>\{familyDetail\}<\/small> : null/);
  assert.match(frame, /<h2>\{title\}<\/h2>/);
  assert.match(frame, /subtitle \? <p className=\{styles\.subtitle\}>\{subtitle\}<\/p> : null/);
  assert.match(frame, /timing \? <div className=\{styles\.timing\}>\{timing\}<\/div> : null/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("shared frame uses the approved pre-flattening header visuals", () => {
  assert.match(frameStyles, /\.familyRow \{[\s\S]*justify-content: space-between/);
  assert.match(frameStyles, /\.familyRow small \{[\s\S]*text-transform: lowercase/);
  assert.match(frameStyles, /\.header h2 \{[\s\S]*clamp\(32px, 9vw, 45px\)/);
  assert.match(frameStyles, /\.subtitle \{[\s\S]*font-size: 13px/);
  assert.match(frameStyles, /\.timing \{[\s\S]*border-radius: 999px[\s\S]*rgba\(214, 225, 177, 0\.52\)/);
});

test("designed card shells restore place zone variant and state details", () => {
  assert.match(venue, /familyDetail="weekly event template" title="Tidy Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Wednesday · whole-space tidy"/);
  assert.match(venue, /familyDetail="weekly event template" title="Prep Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Wednesday · night-before prep"/);
  assert.match(venue, /familyDetail="event opening" title="Host Community Thursday" subtitle="Community Thursday · Elm Farm" timing="Thursday morning · Prep complete"/);
  assert.match(sow, /familyDetail="direct sow bed" title="Field Row 6" subtitle="Field Rows" timing="Today · sowing window open"/);
  assert.match(weed, /familyDetail=\{familyDetail\} title="Field Row 13" subtitle="Field Rows" timing=\{timing\}/);
  assert.match(mow, /title="U-Pick Walkways" subtitle="U-Pick"/);
  assert.match(harvest, /title="Harvest Stems" subtitle=\{zones\.join\(" · "\)\}/);
  assert.match(remaining, /title="Move 15 Zinnias" subtitle="Curve Garden"/);
});

test("crop-cycle actions share one bed wrapper rather than their own task shells", () => {
  assert.match(weed, /function CropCycleBedCard/);
  assert.match(weed, /family="Weed" familyDetail="bed care" timing="Today · weeding due"/);
  assert.match(weed, /family="Irrigation" familyDetail="care pulse" timing="Germination window · irrigate"/);
  assert.match(weed, /family="Check" familyDetail="crop check" timing="Germination window · check stand"/);
  assert.match(weed, /family="Clear \/ Turn over" familyDetail="bed turnover" timing="After harvest · turnover due"/);
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
