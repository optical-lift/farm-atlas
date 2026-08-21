import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const specimen = read("app/owner/task-card-lab/OneOffFieldWorkCardSpecimen.tsx");
const page = read("app/owner/task-card-lab/page.tsx");

test("setup and protection cards stay simple and do not acquire a Trail or useless timing pill", () => {
  assert.doesNotMatch(specimen, /familyDetail="one-off field work"/);
  assert.doesNotMatch(specimen, /Do once · then leave the Day/);
  assert.doesNotMatch(specimen, /EventTrail|className=\{[^}]*trail/i);
  assert.match(specimen, /family="Setup"/);
  assert.match(specimen, /family="Protect"/);
});

test("staking card is reduced to truthful Tools", () => {
  assert.match(specimen, /title="Stake \+ String Beds"/);
  assert.match(specimen, /3 ft beds · 3 ft walkways/);
  assert.match(specimen, /Wooden stakes/);
  assert.match(specimen, /String/);
  assert.match(specimen, /Scissors/);
  assert.match(specimen, /Measuring tape/);
  assert.match(specimen, /restock: true/);
});

test("deer deterrent uses Tools plus Harvest-like area selection and last-sprayed context", () => {
  assert.match(specimen, /title="Spray Garlic Deer Deterrent"/);
  assert.match(specimen, /harvest-card-specimen\.module\.css/);
  assert.match(specimen, /tap what gets sprayed today/);
  assert.match(specimen, /last sprayed/);
  assert.match(specimen, /defaultChecked=\{area\.preselected\}/);
  assert.match(specimen, /Garlic concentrate/);
  assert.match(specimen, /Pump sprayer/);
  assert.match(specimen, /Field Rows/);
  assert.match(specimen, /U-Pick/);
  assert.match(specimen, /TaskRecipeDisclosure/);
});

test("gallery no longer calls these cards one-off", () => {
  assert.match(page, /"Setup \+ Protect"/);
  assert.doesNotMatch(page, /"One-off"/);
});
