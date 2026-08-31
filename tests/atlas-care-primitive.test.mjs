import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Atlas Care separates protected attention from executable intervention", () => {
  const care = read("lib/atlas/care-contract.ts");

  assert.match(care, /"hold" \| "reassess" \| "intervene"/);
  assert.match(care, /"protected_attention"/);
  assert.match(care, /"executable_intervention"/);
  assert.match(care, /releasesExecutableWork: false/);
  assert.match(care, /assessment\.disposition === "reassess"/);
  assert.match(care, /if \(!intervention\)/);
  assert.match(care, /if \(!executionEnabled\)/);
});

test("Atlas Care forbids the clock from inventing physical condition", () => {
  const care = read("lib/atlas/care-contract.ts");
  const weedClock = read("lib/atlas/weed-card-clock-contract.ts");

  assert.match(care, /inferredFromClock: false/);
  assert.match(care, /never manufacture physical condition/);
  assert.match(weedClock, /AtlasCarePhysicalCondition/);
  assert.match(weedClock, /inferredFromClock: false/);
  assert.match(weedClock, /physicalConditionAuthority: "observation_only"/);
});

test("Household care is a static five-zone attention policy, not a chore generator", () => {
  const household = read("lib/atlas/household-care-contract.ts");

  assert.match(household, /atlas_household_five_zone_attention/);
  assert.match(household, /rotating five-zone attention/);
  assert.match(household, /bounded attention rather than whole-zone completion/);
  assert.match(household, /elapsed time creates attention or reassessment, not physical condition/);
  assert.match(household, /disposition: "reassess"/);
  assert.match(household, /executionEnabled: false/);
  assert.match(household, /intervention: null/);
});

test("Household spaces map to care zones by function rather than floor topology", () => {
  const household = read("lib/atlas/household-care-contract.ts");
  const matcher = household.slice(
    household.indexOf("export function householdCareZonesForSpace"),
    household.indexOf("export type AtlasHouseholdZoneAttention"),
  );

  assert.match(household, /floorLevel\?: string \| null/);
  assert.match(matcher, /space\.functionalTags/);
  assert.match(matcher, /template\.functionalTags/);
  assert.doesNotMatch(matcher, /floorLevel/);
  assert.doesNotMatch(matcher, /basement|upstairs/i);
});
