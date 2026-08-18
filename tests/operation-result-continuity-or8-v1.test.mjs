import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const sql = readFileSync(join(root, "supabase/migrations/20260818212733_or8_operation_result_continuity_audit_v1.sql"), "utf8");

test("OR8 audits the completed-operation membrane for silent truth loss", () => {
  assert.match(sql, /or8_operation_effect_projection_lag/i);
  assert.match(sql, /or8_consumed_resource_without_state/i);
  assert.match(sql, /or8_resulting_state_without_continuation/i);
  assert.match(sql, /or8_future_operation_unready_resource_uncovered/i);
  assert.match(sql, /or8_generic_inventory_without_trustworthy_witness/i);
  assert.match(sql, /or8_duplicate_consequence_release/i);
  assert.match(sql, /or8_scheduling_affinity_as_dependency/i);
});

test("OR8 treats lawfully governed blocked work as context rather than a false failure", () => {
  assert.match(sql, /futureOperationUnreadyResourceGovernedCount/i);
  assert.match(sql, /knownBlockedWorkIsNotContinuityFailureWhenResolutionConsequenceExists/i);
  assert.match(sql, /unknownInventoryIsNotZero/i);
  assert.match(sql, /schedulingAffinityIsNotPrerequisite/i);
  assert.match(sql, /principalEscalationCreated',false/i);
});

test("farm continuity v5 incorporates OR8 without replacing the older crop continuity audit", () => {
  assert.match(sql, /farm_continuity_audit_v4/i);
  assert.match(sql, /operation_result_continuity_audit_v1/i);
  assert.match(sql, /operationResultHighPriorityIssueCount/i);
  assert.match(sql, /operationResultStateTransition','audited_by_operation_result_continuity_audit_v1/i);
});
