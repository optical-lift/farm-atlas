import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260804074800_thursday_morning_prep_clusters_v1.sql",
    import.meta.url,
  ),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

const series = [
  "community_thursday_wednesday_farm_close",
  "community_thursday_wednesday_guest_rooms",
  "community_thursday_wednesday_coffee_water",
  "community_thursday_wednesday_kitchen_trash",
];

const templates = [
  "community_thursday_farm_close_v1",
  "community_thursday_guest_rooms_v1",
  "community_thursday_coffee_water_v1",
  "community_thursday_kitchen_trash_v1",
];

test("Thursday preparation becomes four independent top-level work clusters", () => {
  for (const value of series) assert.ok(migration.includes(value));

  for (const title of [
    "Close the Farm Work Areas",
    "Reset the Guest Rooms",
    "Prepare Coffee + Water",
    "Take Out the Kitchen Trash",
  ]) {
    assert.ok(migration.includes(title));
  }

  assert.match(normalized, /maximum_active_instances = 4/i);
  assert.match(normalized, /thursday_prep_cluster_count',4/i);
  assert.match(normalized, /task\.task_series_key = 'community_thursday_wednesday_setup'/i);
  assert.match(normalized, /The monolithic Thursday preparation task is still active/i);
});

test("each calm cluster owns only its related checklist conditions", () => {
  for (const value of templates) assert.ok(migration.includes(value));

  for (const item of [
    "Store farm tools in their proper places",
    "Tidy the farm work areas",
    "Wash and stage the harvest buckets",
    "Clean the bathroom and leave it ready for guests",
    "Clear the Library surfaces and reset the furniture",
    "Clear the meeting room surfaces and reset the furniture",
    "Make cold brew and refrigerate it overnight",
    "Restock and reset the coffee bar",
    "Refill the water dispenser",
    "Take out the kitchen trash",
  ]) {
    assert.ok(migration.includes(item));
  }

  assert.doesNotMatch(migration, /parent_task_id\s*=/i);
  assert.doesNotMatch(migration, /children_sweep_porches_weekly/i);
  assert.doesNotMatch(migration, /yard_stick_pickup_before_wednesday_mowing/i);
});

test("private cluster weights preserve the 120-minute Wednesday close", () => {
  for (const minutes of [40, 50, 25, 5]) {
    assert.ok(migration.includes(`then ${minutes}`));
  }

  assert.match(normalized, /v_capacity_minutes <> 120/i);
  assert.match(normalized, /Private owner capacity estimate for closing the farm work areas/i);
  assert.match(normalized, /Private owner capacity estimate for the bathroom, Library, and meeting room reset/i);
  assert.match(normalized, /Private owner capacity estimate for cold brew, coffee bar, and guest water/i);
  assert.match(normalized, /Private owner capacity estimate for taking out the kitchen trash/i);
});

test("future event occurrences are cloned into all four clusters", () => {
  assert.match(normalized, /cross join \(values \('guest_rooms'/i);
  assert.match(normalized, /having count\(\*\) <> 4/i);
  assert.match(normalized, /Every regular Thursday morning must have four Wednesday preparation occurrences/i);
  assert.match(normalized, /engine_instance_key/i);
  assert.match(normalized, /recurring:' \|\| v_series_key/i);
});
