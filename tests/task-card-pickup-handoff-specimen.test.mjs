import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");
const specimen = readFileSync("app/owner/task-card-lab/PickupHandoffCardSpecimen.tsx", "utf8");

test("Task Card Gallery exposes the pickup handoff specimen", () => {
  assert.match(page, /PickupHandoffCardSpecimen/);
  assert.match(page, /"Pickup \/ Handoff"/);
});

test("pickup handoff is one dock clipboard containing multiple compact orders", () => {
  assert.match(specimen, /title="Pickup Dock"/);
  assert.match(specimen, /familyDetail="order dock"/);
  assert.match(specimen, /Today’s pickup clipboard/);
  assert.match(specimen, /number: "0001"/);
  assert.match(specimen, /number: "0002"/);
  assert.match(specimen, /number: "0003"/);
  assert.match(specimen, /orders\.map/);
  assert.match(specimen, /#\{order\.number\}/);
  assert.match(specimen, /order\.items\.map/);
});

test("dock rows keep finished-good items succinct and payment state tight", () => {
  assert.match(specimen, /2× DIY Build-Your-Own Bouquet Buckets/);
  assert.match(specimen, /2× Sunflower bundles/);
  assert.match(specimen, /1× Zinnia bundle/);
  assert.match(specimen, /payment: "Unpaid"/);
  assert.match(specimen, /payment: "Paid"/);
  assert.match(specimen, /paidPill/);
  assert.match(specimen, /unpaidPill/);
  assert.doesNotMatch(specimen, /sectionLabel}>Customer/);
  assert.doesNotMatch(specimen, /sectionLabel}>Payment/);
  assert.doesNotMatch(specimen, /Reserved items/);
});

test("pickup dock specimen remains fixture-only", () => {
  assert.match(specimen, /Mockup only/);
  assert.match(specimen, /#0001 reflects the described 2:30 pickup/);
  assert.match(specimen, /#0002 and #0003 are fixture rows/);
  assert.match(specimen, /No reservation, inventory, payment, scheduling, or Worker Day behavior is wired/);
  assert.doesNotMatch(specimen, /fetch\(/);
  assert.doesNotMatch(specimen, /supabase/i);
});
