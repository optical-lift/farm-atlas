import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Venue event setup routes to its station detail before the generic checklist", () => {
  const router = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(router, /import VenueTaskDetail/);
  assert.match(router, /task\.task_type === "event_setup"/);
  assert.match(router, /task\.metadata\?\.collection_zone === "Venue"/);
  assert.match(router, /community_thursday_morning_outdoor_v2/);
  assert.match(router, /community_thursday_morning_coffee_water_v2/);
  assert.match(router, /community_thursday_morning_rooms_v2/);

  const venueIndex = router.indexOf("if (isVenueTask(props.task))");
  const genericIndex = router.indexOf("if (isExecutionChecklistTask(props.task))");
  assert.ok(venueIndex >= 0, "Venue route should exist");
  assert.ok(genericIndex >= 0, "generic checklist route should exist");
  assert.ok(venueIndex < genericIndex, "Venue must route before the generic checklist");
  assert.doesNotMatch(router, /farm_round/i);
});

test("Venue station detail separates information from worker actions", () => {
  const component = read("components/atlas/venue-task-detail.tsx");

  assert.match(component, /<span>Venue<\/span>/);
  assert.match(component, /<strong>Station: \{station\}<\/strong>/);
  assert.match(component, /rule\.mugs/);
  assert.match(component, /rule\.coffee/);
  assert.match(component, /rule\.coldBrew === false/);
  assert.doesNotMatch(component, /rule\.water/);
  assert.match(component, /filter\(\(item\) => item\.crossedOut !== true\)/);
  assert.match(component, /<h2>Do<\/h2>/);
  assert.match(component, /actionItems\.map/);
  assert.match(component, /doneDisabled=\{checklist\?\.ready !== true\}/);
});

test("production Venue migration keeps mug choice informational and water confirmation actionable", () => {
  const migration = read("supabase/migrations/20260821204941_retire_venue_mug_info_action_v1.sql");

  assert.match(migration, /'restock_reset_coffee_bar'.*'Guests choose a real mug from the hutch'.*20,false,false,true/s);
  assert.match(migration, /'refill_water_dispenser'.*'Confirm the water dispenser is full\.'.*30,true,false,false/s);
  assert.match(migration, /'retired', true/);
  assert.match(migration, /'retiredReason', template\.retired_reason/);
  assert.match(migration, /set required = false,/);
  assert.match(migration, /Mug selection is station information, not worker action\./);
  assert.match(migration, /execution_checklist_template_key' = 'community_thursday_morning_coffee_water_v2'/);
});
