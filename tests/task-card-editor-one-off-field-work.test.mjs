import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const specimen = read("app/owner/task-card-lab/OneOffFieldWorkCardSpecimen.tsx");
const page = read("app/owner/task-card-lab/page.tsx");

test("one-off field work reuses Venue instructional station grammar without a Trail", () => {
  assert.match(specimen, /venue-card-specimen\.module\.css/);
  assert.match(specimen, /venue-local-rail\.module\.css/);
  assert.match(specimen, /venueStyles\.rowKey/);
  assert.match(specimen, /venueStyles\.stations/);
  assert.match(specimen, /venueStyles\.station/);
  assert.match(specimen, /localStyles\.localStation/);
  assert.match(specimen, /venueStyles\.reminderRow/);
  assert.match(specimen, /localStyles\.localReminderRow/);
  assert.doesNotMatch(specimen, /EventTrail|className=\{[^}]*trail/i);
});

test("staking and garlic deterrent are examples of one reusable one-off grammar", () => {
  assert.match(specimen, /title="Stake \+ String Beds"/);
  assert.match(specimen, /family="Setup"/);
  assert.match(specimen, /3 ft bed width/);
  assert.match(specimen, /3 ft walkway width/);
  assert.match(specimen, /Set wooden stakes at bed ends/);
  assert.match(specimen, /Run string along each bed edge/);
  assert.match(specimen, /title="Spray Garlic Deer Deterrent"/);
  assert.match(specimen, /family="Protect"/);
  assert.match(specimen, /Garlic concentrate/);
  assert.match(specimen, /Use the concentrate label for the mix rate/);
  assert.match(specimen, /Pump sprayer/);
  assert.match(specimen, /Field Rows/);
  assert.match(specimen, /U-Pick/);
});

test("one-off work exists only while needed and is visible from the Task Card Editor", () => {
  assert.match(specimen, /do not receive a Project Trail or a persistent lifecycle/);
  assert.match(specimen, /appears when the work is actually needed/);
  assert.match(specimen, /disappears after completion/);
  assert.match(page, /OneOffFieldWorkCardSpecimen/);
  assert.match(page, /"One-off"/);
});
