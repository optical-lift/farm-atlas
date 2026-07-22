import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const schema = read(
  "supabase/migrations/20260722012002_atlas_add_production_capacity_planner.sql",
);
const calculations = read(
  "supabase/migrations/20260722012256_atlas_add_capacity_calculation_and_readiness_views.sql",
);
const pilot = read(
  "supabase/migrations/20260722012511_atlas_seed_spring_2027_capacity_pilot.sql",
);
const qualificationFix = read(
  "supabase/migrations/20260722012622_atlas_fix_capacity_refresh_function_qualification.sql",
);

test("capacity planner separates pools, measurements, questions, requirements, and reservations", () => {
  for (const relation of [
    "capacity_pools",
    "capacity_measurements",
    "capacity_questions",
    "production_capacity_requirements",
    "capacity_requirement_questions",
    "production_capacity_reservations",
  ]) {
    assert.match(schema, new RegExp(`create table atlas\\.${relation}`));
  }
});

test("capacity reservations preserve farm, lot, requirement, pool, units, and dates", () => {
  assert.match(schema, /Capacity reservation records must belong to the same farm/);
  assert.match(schema, /Capacity reservation requirement must belong to the production lot/);
  assert.match(schema, /Capacity reservation units must match requirement and pool units/);
  assert.match(schema, /window_end >= window_start/);
});

test("capacity facts stay internal during observe mode", () => {
  for (const relation of [
    "capacity_pools",
    "capacity_measurements",
    "capacity_questions",
    "production_capacity_requirements",
    "production_capacity_reservations",
  ]) {
    assert.match(schema, new RegExp(`revoke all on atlas\\.${relation} from public, anon, authenticated`));
  }
  assert.match(calculations, /revoke execute on function atlas\.refresh_grow_room_capacity_pools_v1\(uuid\) from public, anon, authenticated/);
  assert.match(calculations, /revoke execute on function atlas\.refresh_snapdragon_capacity_requirements_v1\(uuid\) from public, anon, authenticated/);
});

test("planner calculates crop demand through blocks, trays, shelves, and bed feet", () => {
  assert.match(qualificationFix, /ceil\(lot_rec\.planned_input_quantity \/ v_seeds_per_block\)/);
  assert.match(qualificationFix, /ceil\(v_blocks \/ v_blocks_per_tray\)/);
  assert.match(qualificationFix, /ceil\(v_trays \/ v_trays_per_shelf\)/);
  assert.match(qualificationFix, /floor\(lot_rec\.planned_input_quantity \* v_viability_percent \/ 100\.0\)/);
  assert.match(qualificationFix, /v_viable_plants \* v_spacing_inches \/ 12\.0/);
  assert.match(qualificationFix, /preparation_due_date = r\.required_by_date - ceil\(v_prep_lead_days\)::integer/);
});

test("grow-light capacity is bounded by both measured coverage and real shelf count", () => {
  assert.match(qualificationFix, /least\(v_total_shelves, v_light_sets \* v_shelves_per_set\)/);
  assert.match(qualificationFix, /grow_room_lit_shelf_positions/);
});

test("readiness and dated load views expose blocked work and overbooking", () => {
  assert.match(calculations, /create view atlas\.production_capacity_readiness_v1/);
  assert.match(calculations, /blocked_by_missing_facts/);
  assert.match(calculations, /calculated_not_reserved/);
  assert.match(calculations, /create view atlas\.capacity_pool_daily_load_v1/);
  assert.match(calculations, /capacity_unknown_or_overbooked/);
  assert.match(calculations, /generate_series\(r\.window_start, r\.window_end/);
});

test("Spring 2027 pilot records only confirmed physical capacity", () => {
  assert.match(pilot, /grow_room_tray_inventory/);
  assert.match(pilot, /grow_room_shelf_positions/);
  assert.match(pilot, /field_row_9_bed_feet/);
  assert.match(pilot, /field_row_10_bed_feet/);
  assert.match(pilot, /grow_room_lit_shelf_positions/);
  assert.match(pilot, /null::numeric,'shelf_positions','unconfirmed'/);
  assert.doesNotMatch(pilot, /insert into atlas\.capacity_measurements/);
  assert.doesNotMatch(pilot, /insert into atlas\.production_capacity_reservations/);
});

test("unknown January planning inputs remain explicit questions", () => {
  for (const question of [
    "rocket_s1_seed_quantity",
    "madame_s2_seed_quantity",
    "snapdragon_seeds_per_three_quarter_block",
    "three_quarter_blocks_per_cafeteria_tray",
    "cafeteria_trays_per_rack_shelf",
    "functional_grow_light_sets",
    "shelf_positions_per_grow_light_set",
    "snapdragon_lit_shelf_occupancy_days",
    "snapdragon_planning_viability_percent",
    "snapdragon_rows_per_three_foot_bed",
    "snapdragon_in_row_spacing_inches",
    "snapdragon_bed_preparation_lead_days",
    "spring_snapdragon_bed_assignments",
  ]) {
    assert.match(pilot, new RegExp(question));
  }
});

test("every pilot production lot receives six capacity requirements", () => {
  for (const kind of [
    "seed_inventory",
    "soil_blocks",
    "tray_positions",
    "rack_shelf_positions",
    "lit_shelf_positions",
    "field_bed_feet",
  ]) {
    assert.match(pilot, new RegExp(`'${kind}'`));
  }
  assert.match(pilot, /case when capacity_kind='seed' and planned_input_quantity is not null then 'confirmed' else 'blocked' end/);
});

test("final refresh functions qualify returned-column names against table aliases", () => {
  assert.match(qualificationFix, /select cp\.total_capacity into v_total_shelves/);
  assert.match(qualificationFix, /where r\.production_lot_id = lot_rec\.id/);
  assert.match(qualificationFix, /where pp\.id = p_program_id/);
});
