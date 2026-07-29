import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("every weed task routes to the plant-aware persistent Weed Card", () => {
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/weed-card-task-loader.tsx");
  const focus = read("components/atlas/weed-card-task-focus.tsx");
  const trail = read("components/atlas/task-dominion-trail.tsx");

  assert.match(canonical, /isWeedTask/);
  assert.match(canonical, /if \(isWeedTask\(props\.task\)\) return <WeedCardTaskLoader/);
  assert.doesNotMatch(canonical, /<ConciseWeedTaskDetail/);
  assert.match(loader, /<ConciseWeedTaskDetail/);
  assert.match(focus, /card\.plants\.map\(\(plant\) => plant\.displayLabel\)/);
  assert.match(focus, /showSubjectLabel=\{false\}/);
  assert.match(focus, /plantLabels=\{plantLabels\}/);
  assert.match(focus, /presentation="field-sheet"/);
  assert.match(trail, /plantLabels/);
  assert.match(trail, /Plants in this bed/);
  assert.doesNotMatch(focus, /Continue the recovery|Current move|Keep the planted material|permanent edge/);
});

test("task plant contents come from canonical object contents", () => {
  const route = read("app/api/atlas/task-plant-contents/route.ts");
  const migration = read("supabase/migrations/20260729084100_task_plant_contents_v1.sql");
  const reader = read("supabase/migrations/20260729090600_persistent_weed_card_reader_v1.sql");
  const contract = read("lib/atlas/weed-card-contract.ts");

  assert.match(route, /task_plant_contents_v1/);
  assert.match(migration, /join atlas\.object_contents oc/);
  assert.match(migration, /'Lemon balm', 'perennial', 'established'/);
  assert.match(migration, /set content_label = 'Iris'/);
  assert.match(migration, /'Italian White'|btrim\(oc\.variety\) \|\| ' sunflower'/);
  assert.match(migration, /note = null/);
  assert.match(migration, /metadata = \(coalesce\(t\.metadata/);
  assert.match(reader, /'plants', v_plants/);
  assert.match(reader, /join atlas\.object_contents|from atlas\.object_contents/);
  assert.match(reader, /distinct on \(lower\(raw\.display_label\)\)/);
  assert.match(reader, /'planned', 'reserved'/);
  assert.match(contract, /plants: AtlasWeedPlant\[\]/);
});