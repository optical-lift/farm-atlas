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

test("shared Dominion frame owns the universal Task Card Editor top and bottom", () => {
  assert.match(frame, /<span>\{family\}<\/span>/);
  assert.match(frame, /<h2>\{title\}<\/h2>/);
  assert.match(frame, />Done<\/button>/);
  assert.match(frame, />Unfinished<\/button>/);
});

test("every displayed Dominion family uses the shared frame", () => {
  assert.match(venue, /<DominionCardFrame family="Venue" title="Tidy Community Thursday">/);
  assert.match(venue, /<DominionCardFrame family="Venue" title="Prep Community Thursday">/);
  assert.match(venue, /<DominionCardFrame family="Venue" title="Host Community Thursday"/);
  assert.match(sow, /<DominionCardFrame family="Sow" title="Field Row 6">/);
  assert.match(weed, /<DominionCardFrame family="Weed" title="Field Row 13">/);
  assert.match(weed, /<DominionCardFrame family="Clear \/ Turn over" title="Field Row 13">/);
  assert.match(mow, /<DominionCardFrame family="Mow" title="U-Pick Walkways">/);
  assert.match(harvest, /<DominionCardFrame family="Harvest" title="Harvest Stems">/);
  assert.match(remaining, /<DominionCardFrame family="Water \/ Care" title="New Zinnia Transplants">/);
  assert.match(remaining, /<DominionCardFrame family="Check" title="Germination Check">/);
  assert.match(remaining, /<DominionCardFrame family="Transplant" title="Move 15 Zinnias">/);
});

test("approved family interiors survive the shared shell swap", () => {
  assert.match(venue, /Tidy → Prep → Host → Reset/);
  assert.match(venue, /Turn on the ice maker/);
  assert.match(sow, /Projections/);
  assert.match(sow, /Seed estimate/);
  assert.match(weed, /Bed map/);
  assert.match(weed, /How’d we do\?/);
  assert.match(mow, /Mow height/);
  assert.match(mow, /3 in/);
  assert.match(mow, /Riding mower/);
  assert.match(harvest, /Harvest season pulse/);
  assert.match(remaining, /Did enough emerge to keep this planting\?/);
  assert.match(remaining, /Water immediately/);
});

test("legacy per-family completion chrome is removed from bespoke specimens", () => {
  assert.doesNotMatch(venue, /Tidy complete|Prep complete|Event open/);
  assert.doesNotMatch(sow, /Sowing complete|Partly sown/);
  assert.doesNotMatch(weed, /Done weeding today|Bed cleared for next crop|Blocked/);
  assert.doesNotMatch(mow, /Mowed to 3 in|Blocked/);
});
