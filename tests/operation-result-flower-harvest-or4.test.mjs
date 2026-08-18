import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const harvest = read(
  "supabase/migrations/20260818191411_or4_flower_harvest_result_state_transition_v1.sql",
);
const idempotencyFix = read(
  "supabase/migrations/20260818191445_or4_flower_harvest_production_bridge_idempotency_fix_v1.sql",
);
const workflowFix = read(
  "supabase/migrations/20260818191957_or4_harvest_reconciliation_workflow_source_fix_v1.sql",
);
const privilegeFix = read(
  "supabase/migrations/20260818192044_or4_internal_predecessor_function_privilege_hardening_v1.sql",
);
const lineage = read(
  "supabase/migrations/20260818194552_or4_promote_2026_pollenless_s5_differentiated_lineage_v1.sql",
);
const continuityRepair = read(
  "supabase/migrations/20260818194840_continuity_grouped_propagation_and_closure_repair_paths_v1.sql",
);
const destinationFix = read(
  "supabase/migrations/20260818195503_continuity_materialized_production_destination_false_positive_fix_v1.sql",
);

test("OR4 harvest witness preserves yes/no/unsure instead of manufacturing certainty", () => {
  assert.match(harvest, /alter column more_available drop not null/i);
  assert.match(harvest, /add column more_availability text generated always as/i);
  assert.match(harvest, /else 'unsure'::text/i);
  assert.match(harvest, /'harvested_uncertain'::text/i);
  assert.match(harvest, /v_more not in \('yes','no','unsure'\)/i);
  assert.match(harvest, /jsonb_build_array\('yes','no','unsure'\)/i);
  assert.match(harvest, /jsonb_build_array\('quarter','half','three_quarters','one','more_than_one'\)/i);
});

test("OR4 worker result uses the structured harvest adapter and keeps Harvest distinct from Ready", () => {
  assert.match(harvest, /record_flower_harvest_output_core_v2/i);
  assert.match(harvest, /record_flower_harvest_output_for_member_v2/i);
  assert.match(harvest, /'domainAdapter','flower_harvest_output_or4_v1'/i);
  assert.match(harvest, /Harvested physical output is not Ready inventory\./i);
  assert.doesNotMatch(harvest, /insert into atlas\.flower_ready_inventory_lots/i);
  assert.doesNotMatch(harvest, /insert into atlas\.flower_preparation_batches/i);
});

test("Harvest reaches Production only through exactly one confirmed lineage", () => {
  for (const source of [harvest, idempotencyFix, workflowFix]) {
    assert.match(source, /atlas\.production_lot_crop_cycles/i);
    assert.match(source, /link\.confidence='confirmed'/i);
    assert.match(source, /v_lot_count<>1/i);
    assert.match(source, /no_confirmed_production_lot_lineage/i);
    assert.match(source, /ambiguous_confirmed_production_lot_lineage/i);
  }

  assert.match(workflowFix, /'crop_cycle',v_event\.crop_cycle_id/i);
  assert.match(workflowFix, /Harvest completion remains true; Production lineage must not be guessed\./i);
});

test("bucket harvest evidence does not become fake stem evidence", () => {
  assert.match(harvest, /event_type='harvest_recorded'/i);
  assert.match(harvest, /'harvestEvidenceKind','flower_bucket_observation'/i);
  assert.match(harvest, /'bucket_equivalent'/i);
  assert.match(harvest, /'quantityExactness'/i);
  assert.match(harvest, /- 'harvestedMarketableStems'/i);
  assert.match(harvest, /- 'harvestedSecondsStems'/i);
  assert.match(harvest, /- 'harvestedDiscardedStems'/i);
  assert.match(harvest, /'production_lot_reforecast_preview_v3'/i);
});

test("OR4 bridge retries are idempotent without rewriting append-only Production events", () => {
  assert.match(idempotencyFix, /select id into v_prod_event_id[\s\S]*idempotency_key=v_prod_key/i);
  assert.match(idempotencyFix, /if v_prod_event_id is null then[\s\S]*insert into atlas\.production_lot_events/i);
  assert.doesNotMatch(idempotencyFix, /on conflict[\s\S]{0,120}do update/i);
});

test("internal predecessor helpers remain service-role-only", () => {
  assert.match(privilegeFix, /production_lot_reforecast_preview_pre_or4_v1[\s\S]*from public,anon,authenticated/i);
  assert.match(privilegeFix, /worker_state_transition_card_pre_or4_v2[\s\S]*from public,anon,authenticated/i);
  assert.match(privilegeFix, /production_lot_reforecast_preview_pre_or4_v1[\s\S]*to service_role/i);
  assert.match(privilegeFix, /worker_state_transition_card_pre_or4_v2[\s\S]*to service_role/i);
});

test("2026 S5 promotion keeps shared succession and differentiated crop bodies", () => {
  assert.match(lineage, /'pollenless_sunflowers_2026_program'/i);
  assert.match(lineage, /'pollenless_sunflowers_2026_s5_fr16_procut_orange'/i);
  assert.match(lineage, /'pollenless_sunflowers_2026_s5_fr17_procut_horizon'/i);
  assert.match(lineage, /S5 succession identity is shared, while the FR16 ProCut Orange body remains its own Production lot\./i);
  assert.match(lineage, /S5 succession identity is shared, while the FR17 ProCut Horizon body remains its own Production lot\./i);
  assert.match(lineage, /'quantityConfidence','unknown'/i);
  assert.match(lineage, /null,'seeds',null,null/i);
  assert.match(lineage, /'primary','confirmed','legacy_production_plan_promotion_v1'/i);
});

test("continuity repair is function-owned management work, not worker blame or Principal noise", () => {
  assert.match(continuityRepair, /'repair_owner_function','farm_operations_propagation'/i);
  assert.match(continuityRepair, /'repair_owner_function','farm_operations'/i);
  assert.match(continuityRepair, /'management','farm_operation','generated','process_continuation'/i);
  assert.match(continuityRepair, /'observes','confirmed','continuity_repair_v1'/i);
  assert.match(continuityRepair, /'clears','confirmed','continuity_repair_v1'/i);
  assert.match(continuityRepair, /inspection itself does not invent a transplant destination or claim the body is healthy/i);
  assert.match(continuityRepair, /task completion alone must not imply the body is empty/i);
  assert.doesNotMatch(continuityRepair, /principal/i);
});

test("materialized Production bodies are not mislabeled as missing a future destination", () => {
  assert.match(destinationFix, /nextTransitionAvailability,operationFunction/i);
  assert.match(destinationFix, /continue_linked_crop_body/i);
  assert.match(destinationFix, /refusing an unsafe patch/i);
});
