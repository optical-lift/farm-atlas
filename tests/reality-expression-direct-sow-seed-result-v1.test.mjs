import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const state = readFileSync(
  "supabase/migrations/20260818174130_operation_result_direct_sow_seed_state_and_readiness_v1.sql",
  "utf8",
);
const links = readFileSync(
  "supabase/migrations/20260818174227_operation_result_seed_task_link_role_v1.sql",
  "utf8",
);
const historical = readFileSync(
  "supabase/migrations/20260818174452_operation_result_direct_sow_seed_worker_adapter_v1.sql",
  "utf8",
);
const projection = readFileSync(
  "supabase/migrations/20260818174624_operation_result_seed_quantity_knowledge_projection_v1.sql",
  "utf8",
);
const effect = readFileSync(
  "supabase/migrations/20260818180847_operation_result_direct_sow_seed_effect_normalization_v2.sql",
  "utf8",
);
const endpoint = readFileSync(
  "supabase/migrations/20260818180910_operation_result_direct_sow_seed_member_endpoint_normalization_v2.sql",
  "utf8",
);
const guard = readFileSync(
  "supabase/migrations/20260818180930_operation_result_seed_completion_guard_normalization_v2.sql",
  "utf8",
);
const card = readFileSync(
  "supabase/migrations/20260818180951_operation_result_direct_sow_worker_card_normalization_v2.sql",
  "utf8",
);

test("OR3 preserves a known seed body without inventing starting quantity", () => {
  assert.match(state, /alter table atlas\.seed_lots alter column received_quantity drop not null/i);
  assert.match(state, /unknown must never be represented as zero/i);
  assert.match(state, /quantity_knowledge_kind in \('unknown','positive_unknown','lower_bound','exact'\)/i);
  assert.match(state, /status in \('verification_required','verified','bounded','uncertain','problem','depleted','retired'\)/i);
  assert.match(state, /procut_orange_second_bag_existing_inventory_2026/i);
  assert.match(state, /unknown_starting_quantity/i);
});

test("the FR11 + FR12 warrant is a lower bound, never an inferred exact count", () => {
  assert.match(state, /or3:procut-orange:fr11-fr12-minimum-bound/i);
  assert.match(state, /lower_bound_confirmed/i);
  assert.match(state, /'quantityRelation','at_least'/i);
  assert.match(state, /'lower_bound',540/i);
  assert.match(state, /minimum bound, not an inferred exact physical count/i);
  assert.match(state, /timeClaimsExactQuantity',false/i);
  assert.match(state, /seed_requirement_quantity',540/i);
  assert.match(state, /canonical_geometry:2x30ft_beds:3_rows:4in/i);
});

test("direct-sow readiness remains a differentiated seed-domain gate", () => {
  assert.match(state, /task_direct_sow_seed_requirement_v1/i);
  assert.match(state, /task_seed_readiness_v1/i);
  assert.match(state, /ready_lower_bound/i);
  assert.match(state, /positive_quantity_unmeasured/i);
  assert.match(state, /quantity_unknown/i);
  assert.match(state, /lowerBoundIsNotExact/i);
  assert.match(state, /positiveUnknownDoesNotSatisfyQuantifiedRequirement/i);
  assert.match(state, /unknownIsNotZero/i);
  assert.match(state, /taskCompletionIsNotInventoryTruth/i);
  assert.match(state, /'seedReady'/i);
  assert.doesNotMatch(state, /alter table atlas\.seed_lot_allocations/i);
  assert.doesNotMatch(state, /alter table atlas\.seed_allocation_consumptions/i);
  assert.doesNotMatch(state, /create table/i);
});

test("sowing input lineage is not rewritten as an inventory recount", () => {
  assert.match(links, /when coalesce\(new\.action_key,''\)='sow'/i);
  assert.match(links, /then 'sowing_input'/i);
  assert.match(links, /do update set\s+link_role=excluded\.link_role/i);
});

test("the oversized historical worker-adapter migration is hash-addressed and normalized forward", () => {
  assert.match(historical, /ba00d0c62c2d9da6d20c5a83256055b1a7197f7d/i);
  assert.match(historical, /20260818180847_operation_result_direct_sow_seed_effect_normalization_v2/i);
  assert.match(historical, /20260818180910_operation_result_direct_sow_seed_member_endpoint_normalization_v2/i);
  assert.match(historical, /20260818180930_operation_result_seed_completion_guard_normalization_v2/i);
  assert.match(historical, /20260818180951_operation_result_direct_sow_worker_card_normalization_v2/i);
  assert.match(historical, /Do not replace this marker with guessed SQL/i);
});

test("direct-sow result reclassifies seed state without fabricating physical consumption", () => {
  assert.match(effect, /record_direct_sow_seed_effect_v1/i);
  assert.match(effect, /depleted','exact_remaining','some_left_unknown/i);
  assert.match(effect, /direct_sow_exact_remaining/i);
  assert.match(effect, /direct_sow_remaining_unknown/i);
  assert.match(effect, /positive_unknown/i);
  assert.match(effect, /timeClaimsExactPhysicalConsumption',false/i);
  assert.match(effect, /Exact physical consumption is not fabricated from an unknown starting balance/i);
  assert.match(effect, /record_task_transition_v1_internal/i);
});

test("Worker result endpoint records operation actual plus seed-domain effect", () => {
  assert.match(endpoint, /record_direct_sow_seed_result_for_member_v1/i);
  assert.match(endpoint, /worker_state_transition_card_v2/i);
  assert.match(endpoint, /direct_sow_seed_v1/i);
  assert.match(endpoint, /production_operation_actuals/i);
  assert.match(endpoint, /record_direct_sow_seed_effect_v1/i);
  assert.match(endpoint, /seed_state_reclassified_and_sow_closed/i);
  assert.match(endpoint, /atlas\.record_direct_sow_seed_result_for_member_v1\(uuid, uuid, uuid, date, text, integer, text, numeric, text\)/i);
  assert.match(endpoint, /'app_endpoint','verified','active',true,true,true/i);
});

test("generic Done cannot bypass the post-sow seed witness", () => {
  assert.match(guard, /seed_inventory_report_required/i);
  assert.match(guard, /seed_governance_required/i);
  assert.match(guard, /operationEffect',''\)='direct_sow_seed_result'/i);
  assert.match(guard, /Done rejected: this sowing operation requires its post-sow seed inventory result before completion/i);
  assert.match(guard, /record_task_transition_v1_internal_legacy/i);
});

test("Worker card exposes the smallest truthful post-sow observation contract", () => {
  assert.match(card, /direct_sow_seed_v1/i);
  assert.match(card, /depleted','exact_remaining','some_left_unknown/i);
  assert.match(card, /exact_remaining.*remainingQuantity/is);
  assert.match(card, /Atlas must not infer an exact balance from task completion/i);
});

test("legacy seed recounts project into the same quantity-knowledge law", () => {
  assert.match(projection, /normalize_seed_inventory_quantity_knowledge_v1/i);
  assert.match(projection, /new\.status in \('verified','depleted'\)/i);
  assert.match(projection, /new\.quantity_knowledge_kind:='exact'/i);
  assert.match(projection, /new\.status='bounded'/i);
  assert.match(projection, /new\.quantity_knowledge_kind:='lower_bound'/i);
  assert.match(projection, /positive_unknown','unknown/i);
});
