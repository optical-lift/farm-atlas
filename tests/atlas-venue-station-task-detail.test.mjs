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
  assert.match(router, /community_thursday_venue_tidy_v1/);
  assert.match(router, /community_thursday_venue_prep_v1/);
  assert.match(router, /community_thursday_venue_host_v1/);

  const venueIndex = router.indexOf("if (isVenueTask(props.task))");
  const genericIndex = router.indexOf("if (isExecutionChecklistTask(props.task))");
  assert.ok(venueIndex >= 0, "Venue route should exist");
  assert.ok(genericIndex >= 0, "generic checklist route should exist");
  assert.ok(venueIndex < genericIndex, "Venue must route before the generic checklist");
});

test("Venue detail renders the approved Task Card Editor lifecycle and local station rail", () => {
  const component = read("components/atlas/venue-task-detail.tsx");
  const rail = read("components/atlas/task-card-venue-rail.module.css");

  assert.doesNotMatch(component, /AssignedTaskExecutionShell/);
  assert.match(component, /AtlasTaskCardFrame/);
  assert.match(component, /type VenueStage = "tidy" \| "prep" \| "host" \| "reset"/);
  assert.match(component, /key: "tidy", label: "Tidy"/);
  assert.match(component, /key: "prep", label: "Prep"/);
  assert.match(component, /key: "host", label: "Host"/);
  assert.match(component, /key: "reset", label: "Reset"/);
  assert.match(component, /aria-label="Community Thursday task trail"/);
  assert.match(component, /rail\.trailNow/);
  assert.match(component, /const sections = useMemo/);
  assert.match(component, /item\.sectionKey \|\| "venue"/);
  assert.match(component, /item\.sectionLabel \|\| "Venue"/);
  assert.match(component, /sections\.map/);
  assert.match(component, /rail\.localStation/);
  assert.match(component, /rail\.localReminderRow/);
  assert.match(component, /filter\(\(item\) => item\.crossedOut !== true\)/);
  assert.match(component, /item\.required \? "true" : "false"/);
  assert.match(component, /const doneDisabled = !checklist \|\| !checklist\.ready/);
  assert.match(rail, /\.trailNow::before/);
  assert.match(rail, /\.localReminderRow::after/);
});

test("Venue reads station information and restock behavior from canonical checklist metadata", () => {
  const component = read("components/atlas/venue-task-detail.tsx");
  const metadataMigration = read("supabase/migrations/20260822001242_venue_checklist_editor_metadata_v2.sql");

  assert.doesNotMatch(component, /rule\.mugs/);
  assert.doesNotMatch(component, /rule\.coffee/);
  assert.doesNotMatch(component, /coldBrew/);
  assert.match(component, /item\.stationLocation/);
  assert.match(component, /item\.restockLabel/);
  assert.match(component, /Venue restock request/);
  assert.match(metadataMigration, /'coffee_mug_hutch'.*'Mug hutch'.*false,'information','Dining room'/s);
  assert.match(metadataMigration, /'water_dispenser'.*'Confirm the water dispenser is full'.*true,'action','Dining room'/s);
  assert.match(metadataMigration, /'coffee_grounds'.*'Coffee grounds'.*'Coffee grounds'/s);
  assert.match(metadataMigration, /'water_cups'.*'Clear cups'.*'Clear cups'/s);
});

test("Venue Host uses the Editor classic checklist while Reset remains trail-only", () => {
  const component = read("components/atlas/venue-task-detail.tsx");

  assert.match(component, /cycleStage === "host"/);
  assert.match(component, /rail\.hostChecklist/);
  assert.match(component, /rail\.classicChecklist/);
  assert.match(component, /Turn on the ice maker|items\.map/);
  assert.doesNotMatch(component, /cycleStage === "reset" \?/);
  assert.doesNotMatch(component, /Reset Community Thursday.*checklist/s);
});

test("production Venue migrations keep mug choice informational, water actionable, and event-derived Tidy Prep Host", () => {
  const mugMigration = read("supabase/migrations/20260821204941_retire_venue_mug_info_action_v1.sql");
  const cycleMigration = read("supabase/migrations/20260821221552_community_thursday_venue_cycle_v1.sql");
  const metadataMigration = read("supabase/migrations/20260822001242_venue_checklist_editor_metadata_v2.sql");

  assert.match(mugMigration, /'restock_reset_coffee_bar'.*'Guests choose a real mug from the hutch'.*20,false,false,true/s);
  assert.match(mugMigration, /'refill_water_dispenser'.*'Confirm the water dispenser is full\.'.*30,true,false,false/s);
  assert.match(mugMigration, /Mug selection is station information, not worker action\./);

  assert.match(cycleMigration, /array\['tidy','prep','host'\]/);
  assert.match(cycleMigration, /'community_thursday_venue_tidy_v1'/);
  assert.match(cycleMigration, /'community_thursday_venue_prep_v1'/);
  assert.match(cycleMigration, /'community_thursday_venue_host_v1'/);
  assert.match(cycleMigration, /sync_community_thursday_venue_cycle_v1/);

  assert.match(metadataMigration, /'water_dispenser'.*true,'action'/s);
  assert.match(metadataMigration, /'coffee_mug_hutch'.*false,'information'/s);
  assert.match(metadataMigration, /'stationLocation'/);
  assert.match(metadataMigration, /'restockLabel'/);
});
