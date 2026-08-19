import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const audit = readFileSync(
  "docs/architecture/operation-result-state-transition-or1-audit.md",
  "utf8",
);

const vocabulary = [
  "REQUIRES",
  "USES",
  "CONSUMES",
  "PRODUCES",
  "MEASURES",
  "CHANGES",
  "TRIGGERS",
  "TRAVELS_WITH",
];

const requiredPrimitives = [
  "atlas.resources",
  "atlas.task_resource_requirements",
  "atlas.action_requirement_templates",
  "atlas.task_prerequisites",
  "atlas.task_dependency_clocks",
  "atlas.task_completion_impact_policies",
  "atlas.task_outcome_events",
  "atlas.task_transitions",
  "atlas.workflow_events",
  "atlas.workflow_handoffs",
  "atlas.work_gate_evaluations",
  "atlas.task_release_queue_items",
  "atlas.seed_lots",
  "atlas.seed_lot_allocations",
  "atlas.seed_allocation_consumptions",
  "atlas.seed_inventory_events",
  "atlas.seed_inventory_state",
  "atlas.seed_lot_task_links",
  "atlas.crop_harvest_events",
  "atlas.crop_harvest_availability",
  "atlas.flower_harvest_batches",
  "atlas.flower_harvest_bucket_observations",
  "atlas.flower_preparation_batches",
  "atlas.flower_ready_inventory_lots",
  "atlas.mowing_events",
  "atlas.mowing_area_state",
  "atlas.record_mowing_result_core_v1",
];

test("OR1 codifies the complete shared operation vocabulary", () => {
  for (const term of vocabulary) {
    assert.match(audit, new RegExp(`\\b${term}\\b`));
  }
});

test("OR1 audits existing primitives before authorizing new DDL", () => {
  for (const primitive of requiredPrimitives) {
    assert.ok(audit.includes(primitive), `missing OR1 primitive ${primitive}`);
  }
  assert.match(audit, /No production DDL is required for OR1 itself/i);
});

test("OR1 preserves differentiated domain truth", () => {
  assert.match(audit, /seed → `seed_allocation_consumptions`/i);
  assert.match(audit, /Harvested flowers stay Harvest truth/i);
  assert.match(audit, /universal completion engine/i);
  assert.match(audit, /universal inventory table/i);
  assert.match(audit, /domain-specific effect adapters/i);
});

test("OR1 identifies exactly the missing mower cross-domain primitives", () => {
  assert.match(audit, /Generic resource event\/state contract/i);
  assert.match(audit, /Scheduling-affinity relation/i);
  assert.match(audit, /no canonical battery push-mower \/ two-battery working-set resource/i);
  assert.match(audit, /No canonical scheduling-affinity table or function exists/i);
});

test("TRAVELS_WITH remains distinct from prerequisite and completion", () => {
  assert.match(audit, /must never mean prerequisite, shared completion, or merged task identity/i);
  assert.match(audit, /Mow Follow-Me Arches/i);
  assert.match(audit, /Mow Curve Garden/i);
});

test("mowing keeps its mature domain result engine and gains resource effects through the membrane", () => {
  assert.match(audit, /record_mowing_result_core_v1/i);
  assert.match(audit, /extend the existing mowing result path rather than create a second mowing completion engine/i);
  assert.match(audit, /charge_consumed/i);
  assert.match(audit, /needs_charge/i);
  assert.match(audit, /charging_started/i);
  assert.match(audit, /Mowing remains complete even when the battery reset remains unresolved/i);
});
