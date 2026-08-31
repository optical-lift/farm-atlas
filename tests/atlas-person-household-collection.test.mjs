import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const ownerFixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
const householdPage = read("app/owner/household/page.tsx");
const householdFixture = read("app/owner/household/HouseholdCollectionFixture.tsx");
const householdStyles = read("app/owner/household/household-collection.module.css");
const notebookRefine = read("app/owner/person-atlas-notebook-v2-refine.css");

test("Household is a real Atlas collection reachable from the person index", () => {
  assert.match(ownerFixture, /label: "Household"/);
  assert.match(ownerFixture, /href: "\/owner\/household"/);
  assert.match(householdPage, /HouseholdCollectionFixture/);
  assert.match(householdFixture, /title: "Household"/);
});

test("Household fixture carries FlyLady-style routines, zones, weekly plan, and timer limits without live mutation", () => {
  assert.match(householdFixture, /title: "Zones"/);
  assert.match(householdFixture, /Entrance · front porch · dining room/);
  assert.match(householdFixture, /title: "Rhythms"/);
  assert.match(householdFixture, /Monday · home blessing/);
  assert.match(householdFixture, /Before bed/);
  assert.match(householdFixture, /15 minutes at a time/);
  assert.doesNotMatch(householdFixture, /fetch\(|\.rpc\(|supabase|api\/atlas/i);
});

test("Household preserves the bounded notebook grammar instead of becoming a dashboard", () => {
  assert.match(householdStyles, /height: 100svh/);
  assert.match(householdStyles, /overflow: hidden/);
  assert.match(householdStyles, /grid-template-rows: auto minmax\(0, 1fr\) 38px/);
  assert.match(householdFixture, /household · \{rangeLabel\}/);
  assert.doesNotMatch(householdStyles, /box-shadow/);
});

test("Daily notebook regains breathing room and keeps Today in structural type", () => {
  assert.match(notebookRefine, /padding-left: 17px/);
  assert.match(notebookRefine, /font-family: var\(--font-atlas-structural\)/);
  assert.match(notebookRefine, /font-size: 20px/);
});
