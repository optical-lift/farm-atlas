import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Zone Registry and object lists expose compact positions from the universal Trail contract", () => {
  const registry = read("app/zones/page.tsx");
  const zone = read("app/zones/[zoneKey]/page.tsx");
  const position = read("components/atlas/trail/AtlasTrailPosition.tsx");
  const adapter = read("lib/atlas/object-trail.ts");

  assert.match(registry, /AtlasTrailPosition/);
  assert.match(registry, /atlasPrimaryTrailForZone/);
  assert.match(registry, /atlas-zone-trail-position/);

  assert.match(zone, /AtlasTrailPosition/);
  assert.match(zone, /atlasTrailFromRegistryObject/);
  assert.match(zone, /atlas-object-list-trail-position/);
  assert.match(zone, /href=\{`\/objects\/\$\{encodeURIComponent\(object\.stable_key\)\}`\}/);

  assert.match(position, /atlasTrailCurrentNode/);
  assert.match(position, /Trail position/);
  assert.doesNotMatch(position, /farm_hand|consultant|Katie|Anna/);

  assert.match(adapter, /export function atlasTrailFromRegistryObject/);
  assert.match(adapter, /export function atlasPrimaryTrailForZone/);
});

test("object workbenches render one full Atlas Trail instead of a feature-owned Now Next Later timeline", () => {
  const page = read("app/objects/[objectKey]/page.tsx");
  const adapter = read("lib/atlas/object-trail.ts");
  const css = read("app/atlas-trail.css");

  assert.match(page, /import AtlasTrail/);
  assert.match(page, /atlasTrailFromObjectWorkbench/);
  assert.match(page, /<AtlasTrail context=\{trail\} mode="full"/);
  assert.match(page, /Path through this place/);
  assert.match(page, /atlas-object-current-task-link/);
  assert.doesNotMatch(page, /OperationalTimelineSection/);
  assert.doesNotMatch(page, /Working timeline/);

  assert.match(adapter, /export function atlasTrailFromObjectWorkbench/);
  assert.match(adapter, /operationalTimeline/);
  assert.match(adapter, /taskHref\(currentItem\.taskId, object\.object_key\)/);
  assert.match(adapter, /status: "projected"/);
  assert.match(adapter, /href: null/);
  assert.doesNotMatch(adapter, /insert into atlas\.tasks|from\("tasks"\).*insert/is);

  assert.match(css, /\.atlas-trail-position/);
  assert.match(css, /\.atlas-object-trail-panel/);
  assert.match(css, /\.atlas-object-current-task-link/);
});

test("only current object moves are playable and future Trail nodes do not release work", () => {
  const adapter = read("lib/atlas/object-trail.ts");
  const trail = read("components/atlas/trail/AtlasTrail.tsx");

  assert.match(adapter, /currentItem\.taskId \? taskHref/);
  assert.match(adapter, /taskId: null,[\s\S]*href: null/);
  assert.match(trail, /node\.status === "current" \|\| node\.status === "blocked"/);
  assert.match(trail, /Boolean\(node\.href\)/);
  assert.doesNotMatch(adapter, /createProjectTask|createFarmTask|postAtlasTaskTransition/);
});
