import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("seed inventory keeps receipt history separate from append-only physical observations", () => {
  const schema = read("supabase/migrations/20260731173819_seed_inventory_freshness_schema_v1.sql");
  const adapter = read("supabase/migrations/20260731174114_seed_inventory_clock_adapter_v1.sql");

  assert.match(schema, /create table if not exists atlas\.seed_inventory_events/);
  assert.match(schema, /create table if not exists atlas\.seed_inventory_state/);
  assert.match(schema, /Seed inventory history is append-only/);
  assert.match(schema, /subject_kind = any\(array\['farm','zone','growing_object','crop_cycle','project','seed_lot'\]\)/);
  assert.match(adapter, /recorded_receipt_quantity/);
  assert.match(adapter, /verified_on_hand_quantity/);
  assert.match(adapter, /consumed_since_verification/);
  assert.match(adapter, /outstanding_reserved_quantity/);
  assert.match(adapter, /projected_on_hand_quantity/);
  assert.match(adapter, /count_trusted/);
  assert.doesNotMatch(adapter, /received_quantity\s*=/);
});

test("the Elm pilot exposes one unverified lot without inventing a count date or cadence", () => {
  const pilot = read("supabase/migrations/20260731175104_elm_seed_inventory_freshness_pilot_v1.sql");

  assert.match(pilot, /johnnys_potomac_ivory_1000_existing_inventory/);
  assert.match(pilot, /verification_required/);
  assert.match(pilot, /importTimestampIsNotCountEvidence/);
  assert.match(pilot, /physicalCountAuthority','observation_only/);
  assert.doesNotMatch(pilot, /insert into atlas\.rhythm_rules/i);
  assert.doesNotMatch(pilot, /insert into atlas\.tasks/i);
  assert.doesNotMatch(pilot, /last_verified_at[^,]*now\(\)/i);
});

test("only the Owner configures a seed count lifespan and the form has no guessed cadence", () => {
  const configuration = read("supabase/migrations/20260731174459_seed_inventory_freshness_configuration_v1.sql");
  const page = read("app/inventory/seeds/page.tsx");

  assert.match(configuration, /Only the farm Owner may configure seed inventory freshness/);
  assert.match(configuration, /p_cadence_days/);
  assert.match(configuration, /p_first_check_date/);
  assert.match(configuration, /inventoryQuantityClaim','unknown_until_counted/);
  assert.match(configuration, /assignedMembershipId',v_assignee\.id/);
  assert.match(page, /Set the first count \+ freshness rule/);
  assert.match(page, /Owner chooses/);
  assert.match(page, /No automatic purchase task/);
  assert.match(page, /cadenceDays: ""/);
  assert.match(page, /firstCheckDate: ""/);
});

test("all seed inventory outcomes preserve physical truth and role boundaries", () => {
  const result = read("supabase/migrations/20260731175035_seed_inventory_result_engine_v1.sql");
  const focus = read("app/task-focus/[taskId]/SeedInventoryFocusPage.tsx");

  for (const outcome of [
    "count_confirmed",
    "count_corrected",
    "restocked",
    "depleted",
    "unable_to_verify",
    "problem_found",
    "retired",
  ]) {
    assert.match(result, new RegExp(outcome));
    assert.match(focus, new RegExp(outcome));
  }
  assert.match(result, /Use Count corrected/);
  assert.match(result, /Use Count confirmed/);
  assert.match(result, /Only the farm Owner may retire a seed lot/);
  assert.match(result, /seed_inventory_owner_handoff/);
  assert.match(result, /state='recovering'/);
  assert.match(result, /upsert_journal_event_v1/);
  assert.match(focus, /Time does not claim any seed was received, consumed, lost, or damaged/);
});

test("trusted seed coverage gates dependent sowing and opens only proven shortfall decisions", () => {
  const dependency = read("supabase/migrations/20260731174836_seed_inventory_dependency_gate_v1.sql");

  assert.match(dependency, /create or replace view atlas\.production_seed_readiness_v1/);
  assert.match(dependency, /assert_production_seed_ready_v1/);
  assert.match(dependency, /record_production_sowing_v1/);
  assert.match(dependency, /A current verified physical seed count is required before sowing/);
  assert.match(dependency, /v_shortfall<=0/);
  assert.match(dependency, /seed_inventory_decision/);
  assert.match(dependency, /trusted physical count does not cover all committed production lots/i);
  assert.match(dependency, /signal_work_occurrence_v1/);
  assert.doesNotMatch(dependency, /low_stock_threshold[\s\S]*plan_work_occurrence_v1/);
});

test("seed recounts remain canonical Atlas tasks with authenticated APIs", () => {
  const api = read("app/api/atlas/seed-inventory/route.ts");
  const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
  const loader = read("components/atlas/seed-inventory-task-loader.tsx");
  const more = read("app/more/page.tsx");

  assert.match(api, /requestOrigin !== request\.nextUrl\.origin/);
  assert.match(api, /requireAtlasApiAccess/);
  assert.match(api, /record_seed_inventory_result_for_member_v1/);
  assert.match(api, /owner_operator_record_seed_inventory_result_v1/);
  assert.doesNotMatch(api, /service_role|createServiceClient/i);
  assert.match(canonical, /SeedInventoryTaskLoader/);
  assert.match(canonical, /seed_inventory_recount/);
  assert.match(loader, /\/api\/atlas\/seed-inventory/);
  assert.match(loader, /SeedInventoryFocusPage/);
  assert.match(more, /Seed inventory/);
  assert.match(more, /\/inventory\/seeds/);
});

test("seed inventory freshness joins the shared Owner Rulebook", () => {
  const migration = read("supabase/migrations/20260731175249_seed_inventory_rulebook_integration_v1.sql");
  const manager = read("app/manage/rhythms/BiologicalRhythmManager.tsx");

  assert.match(migration, /seed_inventory_freshness/);
  assert.match(migration, /when rs\.subject_kind='seed_lot'/);
  assert.match(migration, /owner_revise_biological_rhythm_rule_v1/);
  assert.match(manager, /Seed inventory freshness/);
  assert.match(manager, /never change the physical quantity/);
});
