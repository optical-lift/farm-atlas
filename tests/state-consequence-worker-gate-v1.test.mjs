import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const consequences = read("supabase/migrations/20260818211437_or6_state_consequence_gate_projection_v1.sql");
const legacy = read("supabase/migrations/20260818212022_or6_legacy_resource_status_consequence_v1.sql");
const worker = read("supabase/migrations/20260818212142_or7_worker_day_shared_state_gate_integration_v1.sql");

test("OR6 releases consequences from canonical state with one instance per policy and subject", () => {
  assert.match(consequences, /state_consequence_policies/i);
  assert.match(consequences, /state_consequence_instances/i);
  assert.match(consequences, /unique\(policy_id, subject_kind, subject_id\)/i);
  assert.match(consequences, /state_consequence_events is append-only/i);
  assert.match(consequences, /state_predicate_became_true/i);
});

test("OR6 covers reusable resources, generic stock, seed custody, Harvest preparation, and legacy repair", () => {
  assert.match(consequences, /resource-reusable-energy-needs-charge/i);
  assert.match(consequences, /resource-quantity-count-required/i);
  assert.match(consequences, /resource-quantity-restock-required/i);
  assert.match(consequences, /seed-untrusted-with-future-commitments/i);
  assert.match(consequences, /flower-harvest-output-needs-preparation/i);
  assert.match(legacy, /resource-status-needs-repair/i);
  assert.match(legacy, /repair_stays_operations_until_authority_capital_or_repeated_failure/i);
});

test("OR7 blocks only true execution requirements and keeps preparation context distinct", () => {
  assert.match(worker, /checkFirstIsPreparationNotExecutionBlock/i);
  assert.match(worker, /restockBelowPolicyDoesNotAutomaticallyBlockCurrentOperation/i);
  assert.match(worker, /requirement_role in \('required','seed_input'\) and not requirement_ready/i);
  assert.match(worker, /task_execution_readiness_v2/i);
  assert.match(worker, /worker_day_operational_task_cards_v3/i);
  assert.match(worker, /worker_self_next_up_v3/i);
});
