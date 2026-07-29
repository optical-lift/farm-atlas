import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("ordinary weed tasks use the concise plant-aware task sheet", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const detail = read("components/atlas/concise-weed-task-detail.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");

  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /<ConciseWeedTaskDetail/);
  assert.match(detail, /`Weed \$\{target \? shortObjectLabel/);
  assert.match(detail, /showZoneLabel=\{false\}/);
  assert.match(detail, /showSubjectLabel=\{false\}/);
  assert.match(detail, /presentation="field-sheet"/);
  assert.match(trail, /plantLabels/);
  assert.match(trail, /Plants in this bed/);
  assert.doesNotMatch(detail, /Continue the recovery|Current move|Keep the planted material|permanent edge/);
});

test("task plant contents come from canonical object contents", () => {
  const route = read("app/api/atlas/task-plant-contents/route.ts");
  const migration = read("supabase/migrations/20260729084100_task_plant_contents_v1.sql");

  assert.match(route, /task_plant_contents_v1/);
  assert.match(migration, /join atlas\.object_contents oc/);
  assert.match(migration, /'Lemon balm', 'perennial', 'established'/);
  assert.match(migration, /set content_label = 'Iris'/);
  assert.match(migration, /'Italian White'|btrim\(oc\.variety\) \|\| ' sunflower'/);
  assert.match(migration, /note = null/);
  assert.match(migration, /metadata = \(coalesce\(t\.metadata/);
});
