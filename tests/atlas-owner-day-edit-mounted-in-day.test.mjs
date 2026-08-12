import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner Edit Today is mounted inside the Day route and not the global app shell", () => {
  const summary = read("components/atlas/day-trail-summary.tsx");
  const gate = read("components/atlas/owner-day-plan-gate.tsx");
  const layout = read("app/layout.tsx");

  assert.match(summary, /OwnerDayPlanGate/);
  assert.match(summary, /compact && ownerPlanDateIso \? <OwnerDayPlanGate dateIso=\{ownerPlanDateIso\} \/>/);
  assert.match(gate, /Edit today/);
  assert.match(gate, /Purple is a draft/);
  assert.doesNotMatch(layout, /OwnerDayPlanGate/);
});
