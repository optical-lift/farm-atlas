import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const ownerFixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
const notebook = read("app/owner/PersonAtlasNotebookV2.tsx");
const householdPage = read("app/owner/household/page.tsx");
const householdFixture = read("app/owner/household/HouseholdCollectionFixture.tsx");
const householdStyles = read("app/owner/household/household-collection.module.css");
const notebookRefine = read("app/owner/person-atlas-notebook-v2-refine.css");

test("Household emits today's work into the one person Daily Log", () => {
  assert.match(ownerFixture, /Spend 15 minutes in the living room zone/);
  assert.match(ownerFixture, /"household-zone": "\/owner\/input\/household-zone"/);
  assert.match(ownerFixture, /sourceLinks=\{SOURCE_LINKS\}/);
  assert.match(notebook, /sourceLinks\?: Record<string, string>/);
  assert.match(notebook, /Open its source/);
  assert.match(notebook, /<Link[\s\S]*className=\{className\}[\s\S]*href=\{sourceHref\}/);
});

test("Household itself is a source of state, rules, and evidence rather than another to-do page", () => {
  assert.match(ownerFixture, /label: "Household"/);
  assert.match(ownerFixture, /href: "\/owner\/household"/);
  assert.match(householdPage, /HouseholdCollectionFixture/);
  assert.match(householdFixture, /current state/);
  assert.match(householdFixture, /rules that can emit work/);
  assert.match(householdFixture, /recent evidence/);
  assert.match(householdFixture, /current FlyLady zone/);
  assert.match(householdFixture, /Weekly home blessing/);
  assert.doesNotMatch(householdFixture, /title: "Zones"|title: "Rhythms"|right now|this week|steady things/);
  assert.doesNotMatch(householdFixture, /fetch\(|\.rpc\(|supabase|api\/atlas/i);
});

test("Household source stays bounded and uses structural type for source state", () => {
  assert.match(householdStyles, /height: 100svh/);
  assert.match(householdStyles, /overflow: hidden/);
  assert.match(householdStyles, /grid-template-rows: auto minmax\(0, 1fr\) 38px/);
  assert.match(householdStyles, /\.row strong[\s\S]*font-family: var\(--font-atlas-structural\)/);
  assert.match(householdFixture, /source · feeds Today/);
  assert.doesNotMatch(householdStyles, /box-shadow/);
});

test("Daily notebook keeps breathing room and Today in structural type", () => {
  assert.match(notebookRefine, /padding-left: 17px/);
  assert.match(notebookRefine, /font-family: var\(--font-atlas-structural\)/);
  assert.match(notebookRefine, /font-size: 20px/);
});
