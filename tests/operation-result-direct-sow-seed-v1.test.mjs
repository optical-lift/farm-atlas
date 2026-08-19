import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

const stateAndReadiness = read(
  "supabase/migrations/20260818174130_operation_result_direct_sow_seed_state_and_readiness_v1.sql",
);
const seedEffect = read(
  "supabase/migrations/20260818180847_operation_result_direct_sow_seed_effect_normalization_v2.sql",
);
const completionGuard = read(
  "supabase/migrations/20260818180930_operation_result_seed_completion_guard_normalization_v2.sql",
);
const workerCard = read(
  "supabase/migrations/20260818180951_operation_result_direct_sow_worker_card_normalization_v2.sql",
);

test("OR3 represents seed quantity knowledge without converting unknown into zero", () => {
  assert.match(stateAndReadiness, /unknown must never be represented as zero/i);
  assert.match(stateAndReadiness, /quantity_knowledge_kind in \('unknown','positive_unknown','lower_bound','exact'\)/i);
  assert.match(stateAndReadiness, /'lower_bound',540/i);
  assert.match(stateAndReadiness, /At least 540 ProCut Orange seeds/i);
  assert.match(stateAndReadiness, /exact balance remains unknown/i);
});

test("quantified sowing requires a canonical seed source and sufficient warrant", () => {
  assert.match(stateAndReadiness, /link\.link_role='sowing_input'/i);
  assert.match(stateAndReadiness, /seed_source_unbound/i);
  assert.match(stateAndReadiness, /seed_source_ambiguous/i);
  assert.match(stateAndReadiness, /seed_requirement_quantity',540/i);
  assert.match(stateAndReadiness, /canonical_geometry:2x30ft_beds:3_rows:4in/i);
});

test("post-sow seed result records only the remainder the worker actually knows", () => {
  assert.match(seedEffect, /depleted','exact_remaining','some_left_unknown/i);
  assert.match(seedEffect, /v_knowledge:='positive_unknown'/i);
  assert.match(seedEffect, /Remaining quantity is only accepted with exact_remaining/i);
  assert.match(seedEffect, /timeClaimsExactPhysicalConsumption',false/i);
  assert.match(seedEffect, /Exact physical consumption is not fabricated from an unknown starting balance/i);
});

test("generic Done cannot bypass the required seed-result membrane", () => {
  assert.match(completionGuard, /seed_inventory_report_required/i);
  assert.match(completionGuard, /seed_governance_required/i);
  assert.match(completionGuard, /operationEffect','direct_sow_seed_result/i);
  assert.match(completionGuard, /Done rejected: this sowing operation requires its post-sow seed inventory result before completion/i);
});

test("Worker Day exposes the OR3 domain adapter rather than generic completion", () => {
  assert.match(workerCard, /'domainAdapter','direct_sow_seed_v1'/i);
  assert.match(workerCard, /'contractVersion','record_direct_sow_seed_result_for_member_v1'/i);
  assert.match(workerCard, /jsonb_build_array\('depleted','exact_remaining','some_left_unknown'\)/i);
  assert.match(workerCard, /Atlas must not infer an exact balance from task completion/i);
});
