import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Owner operator projection resolves the selected Farm Hand on the server", () => {
  const route = read("app/api/atlas/owner-day-projection/route.ts");

  assert.match(route, /getAtlasSession/);
  assert.match(route, /readAtlasOwnerOperatorContext/);
  assert.match(route, /effectiveOperatorAccountId/);
  assert.match(route, /effectiveOperatorMembershipId/);
  assert.match(route, /effective\.farmRole !== "farm_hand"/);
  assert.match(route, /readOwnerWeekProjection\(effective\.farmId, effectiveMembershipId, dateIso, 1\)/);
  assert.match(route, /dateIso <= centralDateIso\(\)/);
  assert.doesNotMatch(route, /searchParams\.get\(["']membership/i);
  assert.doesNotMatch(route, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("Owner future projection remains separate from real released task cards", () => {
  const route = read("app/api/atlas/owner-day-projection/route.ts");
  const component = read("components/atlas/owner-tentative-day-projection.tsx");
  const daySummary = read("components/atlas/day-trail-summary.tsx");

  assert.match(route, /readAtlasOperatorUniversalHome/);
  assert.match(route, /atlasUniversalTaskCards\(home\)/);
  assert.match(route, /item\.sourceKind !== "task" \|\| !actualTaskIds\.has\(item\.sourceId\)/);

  assert.match(component, /\/api\/atlas\/owner-day-projection\?date=/);
  assert.match(component, /data-owner-tentative-day-projection="true"/);
  assert.match(component, />Tentative</);
  assert.match(component, />Owner preview</);
  assert.match(component, /They have not been released into/);
  assert.match(component, /useSearchParams/);
  assert.match(component, /\[dateIso\]/);
  assert.doesNotMatch(component, /postAtlasTaskTransition|transition\(|task-focus|<button|<Link/);

  assert.match(daySummary, /OwnerTentativeDayProjection/);
  assert.match(daySummary, /compact \? <OwnerTentativeDayProjection \/>/);
});
