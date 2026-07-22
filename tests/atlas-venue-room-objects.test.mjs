import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260722193000_add_venue_room_objects.sql";
const stateMigrationPath = "supabase/migrations/20260722194500_sync_room_object_state.sql";

test("Venue is a canonical zone with six rentable room objects", () => {
  const migration = read(migrationPath);

  assert.match(migration, /'venue',\s*'Venue',\s*'venue',\s*'rental_operations'/s);
  assert.match(migration, /'room'::text/);
  assert.match(migration, /'room',\s*'rental_room'/s);

  for (const [key, label] of [
    ["venue_lounge", "Lounge"],
    ["venue_library", "Library"],
    ["venue_kitchen", "Kitchen"],
    ["venue_conference_room", "Conference Room"],
    ["venue_bathroom", "Bathroom"],
    ["venue_studio", "Studio"],
  ]) {
    assert.match(migration, new RegExp(`'${key}', '${label}'`));
  }

  assert.match(migration, /insert into atlas\.object_state/);
  assert.match(migration, /active_task_count/);
  assert.match(migration, /booking_ready/);
  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});

test("venue tasks are organized by place, category, and assignee independently", () => {
  const migration = read(migrationPath);

  assert.match(migration, /insert into atlas\.task_objects/);
  assert.match(migration, /'primary_space'/);
  assert.match(migration, /work_category_key/);
  assert.match(migration, /work_category_label/);
  assert.match(migration, /'Doors \+ hardware'/);
  assert.match(migration, /'Trim \+ finish'/);
  assert.match(migration, /'Signage \+ safety'/);
  assert.match(migration, /assigned_membership_id = marshall\.id/);
  assert.match(migration, /stable_key = 'farmhouse_interior'/);
  assert.match(migration, /'operational_area', 'Private House'/);
});

test("room state stays synchronized as linked tasks change", () => {
  const migration = read(stateMigrationPath);
  const client = read("lib/atlas/zone-registry-client.ts");
  const roomInspection = read("components/atlas/room-inspection.tsx");

  assert.match(migration, /refresh_object_active_task_count_v1/);
  assert.match(migration, /after update of status on atlas\.tasks/);
  assert.match(migration, /after insert or update of object_id or delete on atlas\.task_objects/);
  assert.match(migration, /os\.presentability/);
  assert.match(migration, /os\.active_task_count/);
  assert.match(migration, /os\.metadata as state_metadata/);

  assert.match(client, /presentability: string \| null/);
  assert.match(client, /active_task_count: number \| null/);
  assert.match(client, /state_metadata: AtlasRegistryMetadata \| null/);
  assert.match(roomInspection, /object\.active_task_count \?\?/);
  assert.match(roomInspection, /object\.presentability/);
  assert.match(roomInspection, /object\.state_metadata/);
});

test("Today becomes room-first whenever the viewer has room work", () => {
  const day = read("app/day/page.tsx");
  const areas = read("lib/atlas/operational-areas.ts");

  assert.match(day, /atlasTasksHaveRooms\(taskCards\)/);
  assert.match(day, /setViewMode\("zone"\)/);
  assert.match(day, />Area<\/button>/);
  assert.match(day, /AreaTaskGroup/);
  assert.match(day, /atlasTaskWorkCategoryLabel/);
  assert.match(day, /data-operational-area/);

  assert.match(areas, /object\.object_type === "room"/);
  assert.match(areas, /ATLAS_VENUE_ROOM_ORDER/);
  assert.match(areas, /atlasTaskOperationalArea/);
  assert.match(areas, /atlasTaskWorkCategoryLabel/);
  assert.doesNotMatch(areas, /MarshallDashboard|MarshallRoomPortal/);
});

test("Venue rooms appear in the shared zone registry and inspector", () => {
  const registry = read("lib/atlas-data/zone-registry.ts");
  const zonesPage = read("app/zones/page.tsx");
  const zoneDetail = read("app/zones/[zoneKey]/page.tsx");
  const roomInspection = read("components/atlas/room-inspection.tsx");
  const layout = read("app/layout.tsx");

  assert.match(registry, /"venue"/);
  assert.match(registry, /object\.object_type === "room"/);
  assert.match(zonesPage, /VenueZoneLandingCard/);
  assert.match(zoneDetail, /RoomInspectorRow/);
  assert.match(zoneDetail, /task\.zone_id === zone\.id/);
  assert.match(zoneDetail, /Rentable rooms/);
  assert.match(roomInspection, /Rental readiness/);
  assert.match(roomInspection, /Work inside this room/);
  assert.match(layout, /venue-rooms\.css/);
});
