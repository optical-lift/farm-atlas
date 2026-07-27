import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("../app/grow-room/page.tsx", import.meta.url), "utf8");
const contract = readFileSync(new URL("../lib/atlas/grow-room.ts", import.meta.url), "utf8");
const structureApi = readFileSync(new URL("../app/api/atlas/grow-room/structure/route.ts", import.meta.url), "utf8");
const intakeApi = readFileSync(new URL("../app/api/atlas/grow-room/intake/route.ts", import.meta.url), "utf8");
const destinationApi = readFileSync(new URL("../app/api/atlas/grow-room/destination/route.ts", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260727203000_grow_room_intake_and_placement_v1.sql", import.meta.url), "utf8");
const truthFix = readFileSync(new URL("../supabase/migrations/20260727204000_grow_room_intake_profile_truth_fix_v1.sql", import.meta.url), "utf8");

test("one walkthrough can create the physical room and verified living batches", () => {
  assert.match(page, /Set up racks and shelves/);
  assert.match(page, /Inventory a living batch/);
  assert.match(page, /Existing Grow Room record/);
  assert.match(page, /Approximate live plants/);
  assert.match(page, /Intended outdoor destination/);
  assert.match(structureApi, /grow_room_create_structure_v1/);
  assert.match(intakeApi, /grow_room_intake_batch_v1/);
  assert.match(destinationApi, /grow_room_assign_destination_v1/);
});

test("unknown sowing facts remain unknown instead of being manufactured", () => {
  assert.match(migration, /alter column seeds_sown drop not null/);
  assert.match(migration, /alter column sown_date drop not null/);
  assert.match(truthFix, /germinated_date[\s\S]*null, p_live_quantity/);
  assert.match(truthFix, /unknown_sowing_facts_preserved/);
  assert.match(page, /Unknown dates and seed counts stay unknown/);
});

test("intake links real batches to physical positions and outdoor destinations", () => {
  assert.match(migration, /production_tray_batch_locations/);
  assert.match(migration, /source_object_id uuid references atlas\.growing_objects/);
  assert.match(migration, /destination_assigned/);
  assert.match(contract, /GrowRoomDestination/);
  assert.match(contract, /isGrowRoomBatchLocation/);
  assert.match(page, /Save destination/);
});

test("routine watering remains absent from intake and placement", () => {
  assert.match(page, /Watering is not part of this form/);
  assert.doesNotMatch(page, />Watered</);
  assert.doesNotMatch(intakeApi, /p_water|watered_at|moisture/);
  assert.match(migration, /watering_logged', false/);
});

test("all new Grow Room APIs remain membership scoped", () => {
  for (const route of [structureApi, intakeApi, destinationApi]) {
    assert.match(route, /requireAtlasApiAccess/);
    assert.match(route, /createAtlasServerClient/);
    assert.doesNotMatch(route, /atlasSupabase|SUPABASE_SERVICE_ROLE_KEY/);
  }
});
