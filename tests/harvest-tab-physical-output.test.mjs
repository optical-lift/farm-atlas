import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const page = read("app/harvest/page.tsx");
const harvested = read("app/harvest/HarvestedOutputSection.tsx");
const route = read("app/api/atlas/harvested/route.ts");

test("Harvest tab separates forecast truth from physically harvested output", () => {
  assert.match(page, /kicker="Harvest Horizon" title="In the field"/);
  assert.match(page, /HarvestedOutputSection/);
  assert.match(page, /not what has physically come out of the field/);
  assert.match(harvested, /title="Harvested"/);
  assert.match(harvested, /This is not prepared or ready inventory/);
});

test("Harvested projection reads only canonical bucket-scale physical output", () => {
  assert.match(route, /from\("flower_harvest_bucket_observations"\)/);
  assert.match(route, /from\("crop_cycles"\)/);
  assert.doesNotMatch(route, /crop_harvest_events|production_harvest_lots|production_harvest_stand_entries|postharvest_containers/);
  assert.match(route, /HARVESTED_DAYS = 21/);
  assert.match(route, /session\.memberships\.map\(\(membership\) => membership\.farmId\)/);
});

test("1+ bucket observations remain explicit lower bounds through aggregation and display", () => {
  assert.match(route, /row\.bucket_band === "more_than_one"/);
  assert.match(route, /existing\.bucketEquivalentFloor \+= safeFloor/);
  assert.match(route, /existing\.lowerBound = existing\.lowerBound \|\| row\.bucket_band === "more_than_one"/);
  assert.match(harvested, /lowerBound \? "≥" : ""/);
  assert.match(harvested, /A 1\+ bucket observation stays a lower bound instead of being turned into invented precision/);
});

test("empty Harvested state waits for a real worker harvest record", () => {
  assert.match(harvested, /No harvested flower output has been recorded in this window/);
  assert.match(harvested, /When a Harvest task records a bucket amount, the physical output will appear here/);
  assert.doesNotMatch(harvested, /forecast stem|marketable|seconds|discarded/);
});
