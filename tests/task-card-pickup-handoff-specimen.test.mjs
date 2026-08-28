import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("app/owner/task-card-lab/page.tsx", "utf8");
const specimen = readFileSync("app/owner/task-card-lab/PickupHandoffCardSpecimen.tsx", "utf8");

test("Task Card Gallery exposes the pickup handoff specimen", () => {
  assert.match(page, /PickupHandoffCardSpecimen/);
  assert.match(page, /"Pickup \/ Handoff"/);
});

test("pickup handoff mockup attaches exact confirmed output instead of retyping an order", () => {
  assert.match(specimen, /family="Pickup \/ Handoff"/);
  assert.match(specimen, /timing="Today · 2:30 PM"/);
  assert.match(specimen, /Attached from confirmed Condition \+ Bunch output/);
  assert.match(specimen, /2×/);
  assert.match(specimen, /DIY Build-Your-Own Bouquet Buckets/);
  assert.match(specimen, /2 of 2 reserved for this pickup/);
  assert.match(specimen, /2<\/strong> made/);
  assert.match(specimen, /2<\/strong> reserved/);
  assert.match(specimen, /0<\/strong> available/);
});

test("pickup handoff specimen previews fulfillment controls without wiring production behavior", () => {
  assert.match(specimen, />Picked Up<\/button>/);
  assert.match(specimen, />Due<\/button>/);
  assert.match(specimen, />Paid<\/button>/);
  assert.match(specimen, />Complimentary<\/button>/);
  assert.match(specimen, /Mockup only/);
  assert.match(specimen, /No reservation, inventory, payment, scheduling, or Worker Day behavior is wired/);
  assert.doesNotMatch(specimen, /fetch\(/);
  assert.doesNotMatch(specimen, /supabase/i);
});
