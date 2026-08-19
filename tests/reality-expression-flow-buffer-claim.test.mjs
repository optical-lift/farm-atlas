import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase4 = readFileSync(
  "supabase/migrations/20260818000751_reality_expression_flow_buffer_claim_v1.sql",
  "utf8",
);
const sowPolicyFix = readFileSync(
  "supabase/migrations/20260818000834_reality_expression_flow_buffer_claim_sow_policy_match_fix_v1.sql",
  "utf8",
);
const rpcRegistry = readFileSync(
  "supabase/migrations/20260818003219_reality_expression_flow_buffer_claim_rpc_registry_v1.sql",
  "utf8",
);

test("Phase 4 defines read-only Flow / Buffer / Claim and composed Reality Expression contracts", () => {
  assert.match(
    phase4,
    /create or replace function atlas\.production_flow_buffer_claim_v1\(p_production_lot_id uuid\)/i,
  );
  assert.match(
    phase4,
    /create or replace function atlas\.reality_expression_packet_v2\(p_production_lot_id uuid\)/i,
  );
  assert.match(phase4, /\bstable\b/i);
  assert.match(phase4, /set search_path to 'pg_catalog', 'atlas'/i);
  assert.doesNotMatch(phase4, /security\s+definer/i);
});

test("Phase 4 keeps service-internal execution least-privileged", () => {
  for (const signature of [
    "atlas.production_flow_buffer_claim_v1(uuid)",
    "atlas.reality_expression_packet_v2(uuid)",
  ]) {
    const escaped = signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.match(phase4, new RegExp(`revoke all on function ${escaped} from public`, "i"));
    assert.match(phase4, new RegExp(`revoke all on function ${escaped} from anon`, "i"));
    assert.match(phase4, new RegExp(`revoke all on function ${escaped} from authenticated`, "i"));
    assert.match(phase4, new RegExp(`grant execute on function ${escaped} to service_role`, "i"));
  }
});

test("Phase 4 preserves possession, warrant, claim, conflict, and availability boundaries", () => {
  for (const token of [
    "reservationIsNotPhysicalProof",
    "multipleClaimsAreNotConflictWithoutCapacityEvidence",
    "laborEstimateIsNotLaborClaim",
    "unresolvedDestinationIsNotExecutableOperation",
    "shared_claims_unresolved_physical_warrant",
    "insufficient_physical_warrant",
    "task_capacity_rule_policy",
    "not_evaluable_no_human_time_claim",
    "not_available",
  ]) {
    assert.match(phase4, new RegExp(token, "i"));
  }
});

test("Phase 4 does not write the canonical Production rails it projects", () => {
  assert.doesNotMatch(
    phase4,
    /\b(insert\s+into|update|delete\s+from)\s+atlas\.(production_lots|seed_lot_allocations|production_capacity_requirements|production_capacity_reservations|production_bed_assignments|production_lot_tasks|tasks|worker_day_task_placements|task_capacity_rules)\b/i,
  );
});

test("Reality Expression v2 composes Phase 3 rather than duplicating it", () => {
  assert.match(
    phase4,
    /v_base\s*:=\s*atlas\.reality_expression_packet_v1\(p_production_lot_id\)/i,
  );
  assert.match(
    phase4,
    /v_phase4\s*:=\s*atlas\.production_flow_buffer_claim_v1\(p_production_lot_id\)/i,
  );
  assert.match(phase4, /reality_expression_packet_v2/i);
  assert.match(phase4, /contractLineage/i);
  assert.match(phase4, /flowBufferClaim/i);
});

test("the production sow-policy correction is preserved as its own migration", () => {
  assert.match(sowPolicyFix, /production_flow_buffer_claim_v1/i);
  assert.match(sowPolicyFix, /match_task_type/i);
  assert.match(sowPolicyFix, /sowing/i);
  assert.match(sowPolicyFix, /succession_sowing/i);
  assert.match(sowPolicyFix, /sow_seeds/i);
  assert.match(sowPolicyFix, /grant execute on function atlas\.production_flow_buffer_claim_v1\(uuid\) to service_role/i);
});

test("Phase 4 service-internal RPCs are registered with matching privilege expectations", () => {
  for (const signature of [
    "atlas.production_flow_buffer_claim_v1(uuid)",
    "atlas.reality_expression_packet_v2(uuid)",
  ]) {
    assert.match(rpcRegistry, new RegExp(signature.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"));
  }
  assert.match(rpcRegistry, /'service_internal','verified','active'/i);
  assert.match(rpcRegistry, /false,false,true/i);
  assert.match(rpcRegistry, /on conflict \(signature\) do update/i);
});
