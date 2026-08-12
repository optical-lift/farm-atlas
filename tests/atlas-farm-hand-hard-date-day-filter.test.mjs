import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const route = readFileSync(
  new URL("../app/api/atlas/universal-task-cards/route.ts", import.meta.url),
  "utf8",
);

test("Farm Hand Day never silently carries a missed hard-date task", () => {
  assert.match(route, /function hardDateCard/);
  assert.match(route, /calendar_commitment_kind/);
  assert.match(route, /function farmHandDayKeepsCard/);
  assert.match(route, /card\.due_date >= serviceDate/);
  assert.match(route, /return !hardDateCard\(card\)/);
  assert.match(route, /effectiveRole === "farm_hand" && placementDay/);
});

test("explicit choreography can still present a hard-date task on its chosen execution day", () => {
  assert.match(route, /applyDayPlacement\(card, placement\)/);
  assert.match(route, /due_date: placement\.serviceDate/);
  assert.match(route, /canonical_due_date: card\.due_date/);
  assert.ok(route.indexOf("applyDayPlacement(card, placement)") < route.lastIndexOf("farmHandDayKeepsCard"));
});
