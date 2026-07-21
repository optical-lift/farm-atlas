import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { atlasScheduleRouteKey } from "../lib/atlas/task-route-core.js";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("mowing weed-whack tasks remain in the Mowing collection", () => {
  assert.equal(
    atlasScheduleRouteKey({ taskType: "mowing", title: "Mowing — Weed-Whack U-Pick Sunflowers" }),
    "mow",
  );
  assert.equal(
    atlasScheduleRouteKey({ taskType: "maintenance", title: "Weed Field Row 12" }),
    "weed",
  );
  assert.equal(
    atlasScheduleRouteKey({ taskType: "maintenance", title: "Cut back weeds in Field Row 3" }),
    "weed",
  );
});

test("Day, Week, and Month surface Mowing and Weeding as collections", () => {
  const source = read("components/atlas/CanonicalScheduleView.tsx");
  assert.match(source, /\/collections\/weeding/);
  assert.match(source, /\/collections\/mowing/);
  assert.match(source, /CollectionCard/);
  assert.match(source, /withoutMaintenanceCollections/);
  assert.match(source, /atlasIsMaintenanceCollectionRoute/);
});

test("maintenance collection pages use the canonical membership schedule", () => {
  for (const path of ["app/collections/mowing/page.tsx", "app/collections/weeding/page.tsx"]) {
    const source = read(path);
    assert.match(source, /requireAtlasRole\(\["owner", "manager", "farm_hand"\]\)/);
    assert.match(source, /getTaskSchedule/);
    assert.match(source, /CanonicalMaintenanceCollectionView/);
    assert.doesNotMatch(source, /fetchAtlasTaskCards/);
    assert.doesNotMatch(source, /task-cards-client/);
    assert.doesNotMatch(source, /atlasSupabase/);
    assert.doesNotMatch(source, /SUPABASE_SERVICE_ROLE_KEY/);
  }
});
