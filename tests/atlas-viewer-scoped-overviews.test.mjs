import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("operational overview routes use the universal viewer-scoped task reader", () => {
  const client = read("lib/atlas/task-cards-client.ts");
  const route = read("app/api/atlas/universal-task-cards/route.ts");

  for (const pathname of ["/day", "/overview/week", "/overview/month"]) {
    assert.match(client, new RegExp(`pathname === "${pathname.replaceAll("/", "\\/")}"`));
  }

  assert.match(client, /viewerOperationalWindow/);
  assert.match(client, /dueThrough/);
  assert.match(client, /doneDate/);
  assert.match(client, /\/api\/atlas\/universal-task-cards/);
  assert.doesNotMatch(client, /pathname === "\/day"[\s\S]{0,500}\/api\/atlas\/task-cards/);

  assert.match(route, /new URL\(request\.url\)/);
  assert.match(route, /searchParams\.get\("dueThrough"\)/);
  assert.match(route, /searchParams\.get\("doneDate"\)/);
  assert.match(route, /atlasUniversalViewerFromSession/);
  assert.match(route, /readAtlasUniversalHome/);
});

test("day week and month cannot silently fall back to a mixed farm-wide reader", () => {
  const day = read("app/day/page.tsx");
  const adjacentNavigation = read("app/DayAdjacentNavigation.tsx");
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");

  assert.match(day, /useSearchParams\(\)/);
  assert.match(day, /fetchAtlasTaskCards\(\{[\s\S]*?viewerScoped:\s*true,[\s\S]*?dueThrough:\s*dateIso,[\s\S]*?doneDate:\s*dateIso,?[\s\S]*?\}\)/);
  assert.match(day, /requestSequence/);
  assert.doesNotMatch(day, /atlas:day-change/);
  assert.match(adjacentNavigation, /router\.push\(`/);
  assert.doesNotMatch(adjacentNavigation, /history\.pushState/);

  assert.match(week, /fetchAtlasTaskCards\(\{[\s\S]*?viewerScoped:\s*true,[\s\S]*?dueThrough:\s*resolvedEnd,[\s\S]*?doneDate:\s*resolvedAnchor[\s\S]*?\}\)/);
  assert.match(month, /fetchAtlasTaskCards\(\{[\s\S]*?viewerScoped:\s*true,[\s\S]*?doneDate:\s*resolvedAnchor,[\s\S]*?dueThrough:\s*resolvedEnd[\s\S]*?\}\)/);

  for (const page of [day, week, month]) {
    assert.doesNotMatch(page, /scope:\s*"all"/);
    assert.doesNotMatch(page, /scope:\s*"farm"/);
  }
});
