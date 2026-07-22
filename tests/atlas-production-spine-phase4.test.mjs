import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const stageSchema = read(
  "supabase/migrations/20260722040535_atlas_add_production_stage_schema.sql",
);
const sowing = read(
  "supabase/migrations/20260722040645_atlas_add_production_sowing_command.sql",
);
const germination = read(
  "supabase/migrations/20260722040745_atlas_add_production_germination_command.sql",
);
const seedlingSeal = read(
  "supabase/migrations/20260722040832_atlas_seal_production_seedling_engine.sql",
);
const transplantSchema = read(
  "supabase/migrations/20260722040911_atlas_add_production_transplant_schema.sql",
);
const seedlingCare = read(
  "supabase/migrations/20260722040950_atlas_add_production_seedling_care_command.sql",
);
const transplantGate = read(
  "supabase/migrations/20260722041029_atlas_add_production_transplant_gate.sql",
);
const readiness = read(
  "supabase/migrations/20260722041126_atlas_add_production_readiness_command.sql",
);
const bedPrepRefresh = read(
  "supabase/migrations/20260722041139_atlas_refresh_transplant_gate_from_bed_prep.sql",
);
const transplant = read(
  "supabase/migrations/20260722041248_atlas_add_production_transplant_command.sql",
);
const transplantSeal = read(
  "supabase/migrations/20260722041314_atlas_seal_production_transplant_engine.sql",
);

const phase4 = [
  stageSchema,
  sowing,
  germination,
  seedlingSeal,
  transplantSchema,
  seedlingCare,
  transplantGate,
  readiness,
  bedPrepRefresh,
  transplant,
  transplantSeal,
].join("\n");

test("physical tray cohorts and exact seed consumption preserve lot identity", () => {
  assert.match(stageSchema, /create table atlas\.production_tray_batches/);
  assert.match(stageSchema, /create table atlas\.seed_allocation_consumptions/);
  assert.match(stageSchema, /create table atlas\.production_stage_observations/);
  assert.match(sowing, /record_production_sowing_v1/);
  assert.match(sowing, /quantity_consumed/);
  assert.match(sowing, /Seed consumption exceeds the reserved allocation|cannot exceed/i);
});

test("sowing cannot be represented by a generic done tap", () => {
  assert.match(sowing, /p_seed_quantity/);
  assert.match(sowing, /p_tray_count/);
  assert.match(sowing, /production_tray_batches/);
  assert.match(sowing, /record_task_transition_v1_internal/);
});

test("germination and seedling care preserve counted biological state", () => {
  assert.match(germination, /p_action not in \('not_yet','germinated','failed'\)/);
  assert.match(germination, /Counted seedlings are required/);
  assert.match(germination, /Observed seedlings cannot exceed seeds sown/);
  assert.match(seedlingCare, /surviving_seedlings|current_quantity/);
  assert.match(seedlingCare, /production_readiness/);
});

test("readiness observations cannot create seedlings", () => {
  assert.match(readiness, /p_action not in \('not_ready','ready','failed'\)/);
  assert.match(readiness, /Surviving seedling count exceeds the current tray cohort/);
  assert.match(readiness, /production_readiness_observations/);
  assert.match(readiness, /actual_bed_feet_required/);
});

test("the transplant gate separates biology from prepared field capacity", () => {
  assert.match(transplantGate, /production_transplant_gates/);
  assert.match(transplantGate, /waiting_bed_assignment/);
  assert.match(transplantGate, /waiting_bed_preparation/);
  assert.match(transplantGate, /ready/);
  assert.match(bedPrepRefresh, /refresh_production_transplant_gate_v1/);
});

test("transplanting requires exact per-bed placements", () => {
  assert.match(transplantSchema, /production_transplant_placements/);
  assert.match(transplant, /jsonb_typeof\(p_placements\)<>'array'/);
  assert.match(transplant, /Every placement must use an active bed assignment/);
  assert.match(transplant, /Placement exceeds the measured density/);
  assert.match(transplant, /plantsTransplanted/);
  assert.match(transplant, /planting_claims/);
  assert.match(transplant, /crop_cycles/);
});

test("the field handoff opens an establishment check without inventing survival", () => {
  assert.match(transplant, /establishment/i);
  assert.match(transplant, /production_lot_tasks/);
  assert.doesNotMatch(transplant, /established_plants|plants_alive/);
});

test("phase 4 remains internal and does not expose a service credential", () => {
  assert.match(seedlingSeal, /revoke/i);
  assert.match(transplantSeal, /revoke/i);
  assert.match(transplantSeal, /service_role/);
  assert.doesNotMatch(phase4, /SUPABASE_SERVICE_ROLE_KEY/);
});
