import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Venue event setup routes to its Venue family before the generic checklist", () => {
  const router = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(router, /import VenueTaskDetail/);
  assert.match(router, /task\.task_type === "event_setup"/);
  assert.match(router, /task\.metadata\?\.collection_zone === "Venue"/);
  assert.match(router, /community_thursday_morning_outdoor_v2/);
  assert.match(router, /community_thursday_morning_coffee_water_v2/);
  assert.match(router, /community_thursday_morning_rooms_v2/);
  assert.match(router, /community_thursday_venue_tidy_v1/);
  assert.match(router, /community_thursday_venue_prep_v1/);
  assert.match(router, /community_thursday_venue_host_v1/);

  const venueIndex = router.indexOf("if (isVenueTask(props.task))");
  const genericIndex = router.indexOf("if (isExecutionChecklistTask(props.task))");
  assert.ok(venueIndex >= 0, "Venue route should exist");
  assert.ok(genericIndex >= 0, "generic checklist route should exist");
  assert.ok(venueIndex < genericIndex, "Venue must route before the generic checklist");
});

test("Venue detail renders the governed Community Thursday trail and grouped room/station sections", () => {
  const component = read("components/atlas/venue-task-detail.tsx");

  assert.match(component, /type VenueStage = "tidy" \| "prep" \| "host" \| "reset"/);
  assert.match(component, /key: "tidy", label: "Tidy"/);
  assert.match(component, /key: "prep", label: "Prep"/);
  assert.match(component, /key: "host", label: "Host"/);
  assert.match(component, /key: "reset", label: "Reset"/);
  assert.match(component, /aria-label="Community Thursday task trail"/);
  assert.match(component, /cycleStage \? `\$\{cycleStage\[0\]\.toUpperCase\(\)\}\$\{cycleStage\.slice\(1\)\} Community Thursday` : `Station: \$\{station\}`/);
  assert.match(component, /const sections = useMemo/);
  assert.match(component, /sectionKey \|\| "venue"/);
  assert.match(component, /sectionLabel \|\| station/);
  assert.match(component, /sections\.map/);
  assert.match(component, /room \+ station memory aids/);
  assert.match(component, /filter\(\(item\) => item\.crossedOut !== true\)/);
  assert.match(component, /item\.required \? <span className="atlas-venue-item__required">required<\/span>/);
  assert.match(component, /doneDisabled=\{checklist\?\.ready !== true\}/);
});

test("Venue keeps legacy free-morning station information separated from worker actions", () => {
  const component = read("components/atlas/venue-task-detail.tsx");

  assert.match(component, /rule\.mugs/);
  assert.match(component, /rule\.coffee/);
  assert.match(component, /rule\.coldBrew === false/);
  assert.doesNotMatch(component, /rule\.water/);
});

test("production Venue migrations keep mug choice informational, water actionable, and event-derived Tidy Prep Host", () => {
  const mugMigration = read("supabase/migrations/20260821204941_retire_venue_mug_info_action_v1.sql");
  const cycleMigration = read("supabase/migrations/20260821221552_community_thursday_venue_cycle_v1.sql");

  assert.match(mugMigration, /'restock_reset_coffee_bar'.*'Guests choose a real mug from the hutch'.*20,false,false,true/s);
  assert.match(mugMigration, /'refill_water_dispenser'.*'Confirm the water dispenser is full\.'.*30,true,false,false/s);
  assert.match(mugMigration, /Mug selection is station information, not worker action\./);

  assert.match(cycleMigration, /array\['tidy','prep','host'\]/);
  assert.match(cycleMigration, /'community_thursday_venue_tidy_v1'/);
  assert.match(cycleMigration, /'community_thursday_venue_prep_v1'/);
  assert.match(cycleMigration, /'community_thursday_venue_host_v1'/);
  assert.match(cycleMigration, /'water_dispenser'.*'Confirm the water dispenser is full'.*true,'action'/s);
  assert.match(cycleMigration, /'coffee_mug_hutch'.*'Mug hutch'.*false,'information'/s);
  assert.match(cycleMigration, /sync_community_thursday_venue_cycle_v1/);
});
