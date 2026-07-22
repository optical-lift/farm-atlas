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
const seedlingCare = read(
  "supabase/migrations/20260722040950_atlas_add_production_seedling_care_command.sql",
);
const readiness = read(
  "supabase/migrations/20260722041126_atlas_add_production_readiness_command.sql",
);
const transplant = read(
  "supabase/migrations/20260722041248_atlas_add_production_transplant_command.sql",
);
const fieldStandSchema = read(
  "supabase/migrations/20260722043847_atlas_add_production_field_stand_and_care_schema.sql",
);
const consolidate = read(
  "supabase/migrations/20260722044631_atlas_consolidate_production_field_care_sources.sql",
);
const canonicalPolicy = read(
  "supabase/migrations/20260722050107_atlas_make_field_stands_and_care_policies_canonical.sql",
);
const establishment = read(
  "supabase/migrations/20260722051030_atlas_add_canonical_production_establishment_command.sql",
);
const fieldCare = read(
  "supabase/migrations/20260722051702_atlas_add_canonical_production_field_care_commands.sql",
);
const seal = read(
  "supabase/migrations/20260722052234_atlas_seal_canonical_production_field_engine.sql",
);
const weedingCompatibility = read(
  "supabase/migrations/20260722044259_atlas_exempt_production_care_from_generic_weeding_dedupe.sql",
);

const allPhase4 = [
  stageSchema,
  sowing,
  germination,
  seedlingCare,
  readiness,
  transplant,
  fieldStandSchema,
  consolidate,
  canonicalPolicy,
  establishment,
  fieldCare,
  seal,
].join("\n");

test("production lineage keeps physical cohorts instead of using tasks as identity", () => {
  assert.match(stageSchema, /create table atlas\.production_tray_batches/);
  assert.match(stageSchema, /create table atlas\.seed_allocation_consumptions/);
  assert.match(stageSchema, /create table atlas\.production_stage_observations/);
  assert.match(fieldStandSchema, /create table atlas\.production_field_stands/);
  assert.match(fieldStandSchema, /transplant_placement_id uuid not null/);
  assert.match(fieldStandSchema, /unique \(production_lot_id, object_id\)/);
});

test("seed use is exact, bounded, and attached to the source allocation", () => {
  assert.match(sowing, /record_production_sowing_v1/);
  assert.match(sowing, /seed_allocation_consumptions/);
  assert.match(allPhase4, /quantity_consumed/);
  assert.match(allPhase4, /allocation_status='consumed'/);
  assert.match(allPhase4, /cannot exceed/i);
});

test("biological observations require counted quantities and preserve failures", () => {
  assert.match(germination, /p_action not in \('not_yet','germinated','failed'\)/);
  assert.match(germination, /Counted seedlings are required/);
  assert.match(germination, /Observed seedlings cannot exceed seeds sown/);
  assert.match(readiness, /p_action not in \('not_ready','ready','failed'\)/);
  assert.match(readiness, /Surviving seedling count exceeds the current tray cohort/);
  assert.match(readiness, /Owner — Decide recovery/);
});

test("transplanting requires counted seedlings, assigned beds, and exact placements", () => {
  assert.match(readiness, /actual_bed_feet_required/);
  assert.match(transplant, /jsonb_typeof\(p_placements\)<>'array'/);
  assert.match(transplant, /Every placement must use an active bed assignment/);
  assert.match(transplant, /Placement exceeds the measured density/);
  assert.match(transplant, /production_transplant_placements/);
  assert.match(transplant, /plantsTransplanted/);
});

test("one field stand is the authoritative living-count source for each planted bed", () => {
  assert.match(fieldStandSchema, /current_plants \+ total_losses = plants_transplanted/);
  assert.match(fieldStandSchema, /create_production_field_stand_after_transplant_v1/);
  assert.match(consolidate, /Field care state must mirror its production field stand count/);
  assert.match(establishment, /from atlas\.production_field_stands/);
  assert.match(fieldCare, /update atlas\.production_field_stands/);
  assert.match(fieldCare, /select coalesce\(sum\(current_plants\),0\)/);
});

test("establishment counts every active stand and cannot create plants", () => {
  assert.match(establishment, /Every active field stand requires one establishment count/);
  assert.match(establishment, /cannot exceed the prior living count/);
  assert.match(establishment, /p_action not in \('not_yet','established','failed'\)/);
  assert.match(establishment, /Failed establishment must record zero living plants/);
  assert.match(establishment, /establishment_not_yet/);
  assert.match(establishment, /establishment_failed/);
});

test("field care preserves losses and updates every linked operating surface", () => {
  assert.match(fieldCare, /p_action not in \('water','weed','pinch'\)/);
  assert.match(fieldCare, /Every bed linked to this care task must be confirmed/);
  assert.match(fieldCare, /cannot increase living plants/);
  assert.match(fieldCare, /production_field_observations/);
  assert.match(fieldCare, /object_activity_events/);
  assert.match(fieldCare, /object_state/);
  assert.match(fieldCare, /production_lot_events/);
  assert.match(fieldCare, /record_task_transition_v1_internal/);
});

test("care policies, not hardcoded crop assumptions, control harvest readiness", () => {
  assert.match(fieldStandSchema, /create table atlas\.production_care_policies/);
  assert.match(canonicalPolicy, /sync_production_care_policies_v1/);
  assert.match(canonicalPolicy, /required_before_harvest/);
  assert.match(canonicalPolicy, /v_required_policies<>v_satisfied_policies/);
  assert.match(canonicalPolicy, /Owner — Set pinch \+ harvest rules/);
  assert.match(fieldCare, /set_production_harvest_rules_v1/);
  assert.match(fieldCare, /policy_status.*required.*not_required/s);
  assert.match(fieldCare, /production_field_pinch_/);
});

test("harvest readiness opens only after establishment, rules, and care are satisfied", () => {
  assert.match(canonicalPolicy, /waiting_establishment/);
  assert.match(canonicalPolicy, /waiting_rules/);
  assert.match(canonicalPolicy, /waiting_care/);
  assert.match(canonicalPolicy, /ready_for_watch/);
  assert.match(canonicalPolicy, /Open harvest readiness/);
  assert.match(canonicalPolicy, /harvest_watch_start/);
  assert.match(canonicalPolicy, /record_task_transition_v1_internal/);
});

test("production cohort weeding remains separate from generic zone dedupe", () => {
  assert.match(weedingCompatibility, /t\.task_type<>'production_field_care'/);
  assert.match(establishment, /'production_weed'/);
  assert.match(establishment, /'production_field_care'/);
});

test("internal production records and commands remain sealed", () => {
  assert.match(seal, /enable row level security/);
  assert.match(seal, /revoke all on atlas\.production_field_stands,atlas\.production_care_policies from public,anon,authenticated/);
  assert.match(seal, /revoke execute on function atlas\.record_production_establishment_v1/);
  assert.match(seal, /revoke execute on function atlas\.record_production_field_care_v1/);
  assert.match(seal, /revoke execute on function atlas\.set_production_harvest_rules_v1/);
  assert.match(seal, /grant execute on function atlas\.record_production_establishment_v1.*service_role/s);
  assert.doesNotMatch(allPhase4, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("historical concurrent drafts are explicitly consolidated", () => {
  assert.match(consolidate, /drop table if exists atlas\.production_harvest_readiness_gates/);
  assert.match(consolidate, /reconcile_production_field_care_sources_v1/);
  assert.match(consolidate, /production_field_stand_id|field_stand_id/);
  assert.match(consolidate, /select atlas\.reconcile_production_field_care_sources_v1\(\)/);
});
