import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const spine = read(
  "supabase/migrations/20260722010035_atlas_add_production_lot_spine.sql",
);
const pilot = read(
  "supabase/migrations/20260722010123_atlas_seed_spring_2027_snapdragon_pilot.sql",
);

test("production spine preserves program, inventory, cohort, task, cycle, and event identities", () => {
  for (const relation of [
    "production_programs",
    "seed_lots",
    "production_lots",
    "seed_lot_allocations",
    "production_lot_tasks",
    "production_lot_crop_cycles",
    "production_lot_events",
  ]) {
    assert.match(spine, new RegExp(`create table atlas\\.${relation}`));
  }

  for (const view of [
    "seed_lot_inventory_v1",
    "production_lot_lineage_v1",
    "production_program_summary_v1",
  ]) {
    assert.match(spine, new RegExp(`create view atlas\\.${view}`));
  }
});

test("seed inventory cannot be silently overallocated", () => {
  assert.match(spine, /validate_seed_lot_allocation_v1/);
  assert.match(spine, /Seed allocation exceeds received inventory/);
  assert.match(spine, /allocation_status in \('reserved','consumed'\)/);
  assert.match(spine, /available_quantity/);
  assert.match(spine, /overallocated/);
});

test("production events are append-only and retain operational links", () => {
  assert.match(spine, /prevent_production_lot_event_mutation_v1/);
  assert.match(spine, /write a correcting event instead/);
  assert.match(spine, /task_id uuid references atlas\.tasks/);
  assert.match(spine, /crop_cycle_id uuid references atlas\.crop_cycles/);
  assert.match(spine, /object_id uuid references atlas\.growing_objects/);
  assert.match(spine, /idempotency_key text not null/);
});

test("cross-farm and crop-profile links are guarded", () => {
  assert.match(spine, /Seed lot and production lot must belong to the same farm/);
  assert.match(spine, /Seed lot and production lot crop profiles must match/);
  assert.match(spine, /Production lot and task must belong to the same farm/);
  assert.match(spine, /Production lot and crop cycle profiles must match/);
  assert.match(spine, /Production event object must belong to the same farm/);
});

test("production spine remains internal during observe mode", () => {
  assert.match(spine, /enable row level security/);
  assert.match(spine, /revoke all on atlas\.production_programs/);
  assert.match(spine, /from anon, authenticated/);
  assert.match(spine, /grant select, insert on atlas\.production_lot_events to service_role/);
  assert.match(spine, /revoke execute on function atlas\.validate_seed_lot_allocation_v1\(\) from public, anon, authenticated/);
});

test("spring 2027 snapdragon pilot keeps unknown quantities unknown", () => {
  assert.match(pilot, /spring_2027_snapdragon_program/);
  assert.match(pilot, /snapdragon_rocket_spring_2027_s1/);
  assert.match(pilot, /snapdragon_madame_butterfly_spring_2027_s2/);
  assert.match(pilot, /null::numeric/);
  assert.match(pilot, /Unknown seed quantities remain null until physically inventoried/);
});

test("Potomac inventory splits into two confirmed 500-seed successions", () => {
  assert.match(pilot, /johnnys_potomac_ivory_1000_existing_inventory/);
  assert.match(pilot, /received_quantity/);
  assert.match(pilot, /1000/);
  assert.match(pilot, /snapdragon_potomac_ivory_spring_2027_s3/);
  assert.match(pilot, /snapdragon_potomac_ivory_spring_2027_s4/);
  assert.match(pilot, /500::numeric/);
  assert.match(pilot, /allocation_status/);
  assert.match(pilot, /'reserved'/);
});

test("all four future sowing tasks are linked to durable production lots", () => {
  for (const taskKey of [
    "spring_snapdragon_2027_s1_rocket",
    "spring_snapdragon_2027_s2_madame",
    "spring_snapdragon_2027_s3_potomac_ivory",
    "spring_snapdragon_2027_s4_potomac_ivory",
  ]) {
    assert.match(pilot, new RegExp(taskKey));
  }

  assert.match(pilot, /insert into atlas\.production_lot_tasks/);
  assert.match(pilot, /'sowing'/);
});
