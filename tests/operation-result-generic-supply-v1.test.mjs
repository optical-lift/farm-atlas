import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const specimen = read("supabase/migrations/20260818210351_or5_generic_supply_inventory_specimen_v1.sql");
const consolidation = read("supabase/migrations/20260818211342_or5_generic_supply_contract_consolidation_v2.sql");

test("OR5 begins generic cup inventory from witnessed uncertainty, not a fabricated count", () => {
  assert.match(specimen, /venue_clear_cold_cups/i);
  assert.match(specimen, /quantity_governed/i);
  assert.match(specimen, /quantity_truth','unknown_until_counted/i);
  assert.match(specimen, /check_first/i);
  assert.match(specimen, /Unknown quantity is not evidence of shortage/i);
  assert.match(specimen, /no authoritative count or required quantity has been established/i);
});

test("OR5 separates stock policy, committed demand, and physical inventory", () => {
  assert.match(consolidation, /requirement_role in \('consumed','required','reserved'\)/i);
  assert.match(consolidation, /physicalInventoryIsNotCommittedDemand/i);
  assert.match(consolidation, /requirementIsNotConsumptionUntilResult/i);
  assert.match(consolidation, /stockPolicyIsNotDemand/i);
  assert.match(consolidation, /unknownIsNotZero/i);
  assert.match(specimen, /stock_floor/i);
  assert.match(specimen, /stock_target/i);
});

test("OR5 applies declared consumption only after a true task completion", () => {
  assert.match(consolidation, /task_transition_generic_resource_effects_or5_v1/i);
  assert.match(consolidation, /requirement_role='consumed'/i);
  assert.match(consolidation, /v_req\.resource_id,'consumed'/i);
  assert.match(consolidation, /-v_req\.quantity_needed/i);
  assert.match(consolidation, /generic_resource_reconciliation_required/i);
  assert.match(consolidation, /The human completion remains true; the generic resource effect must be reconciled separately/i);
});
