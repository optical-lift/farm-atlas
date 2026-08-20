import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const p7 = readFileSync(
  "supabase/migrations/20260820002113_p7_requirement_continuity_auditor_v1.sql",
  "utf8",
);
const workerBoundary = readFileSync(
  "supabase/migrations/20260820002204_p7_worker_actionability_audit_service_boundary_v2.sql",
  "utf8",
);

const requiredIssueKeys = [
  "requirement_due_without_expression",
  "blocked_execution_without_lawful_continuation",
  "consequential_gap_without_jurisdiction",
  "gap_with_jurisdiction_without_acquisition_continuation",
  "reconstructed_living_body_excluded_from_progression",
  "requirement_clock_reset_detected",
  "worker_day_card_without_available_action",
  "requirement_generation_depends_on_perfect_history",
  "unresolved_decision_hides_source_consequence",
  "duplicate_acquisition_paths_for_one_gap",
  "principal_escalation_without_ownership_membrane_crossing",
];

test("P7 audits every governed Requirement → Acquisition continuity failure family", () => {
  assert.match(p7, /create or replace function atlas\.requirement_continuity_audit_v1/);
  for (const issueKey of requiredIssueKeys) {
    assert.ok(p7.includes(`'${issueKey}'`), `missing P7 issue family ${issueKey}`);
  }
  assert.match(p7, /'requirementExpression',true/);
  assert.match(p7, /'executionWarrant',true/);
  assert.match(p7, /'gapCausality',true/);
  assert.match(p7, /'jurisdiction',true/);
  assert.match(p7, /'acquisitionContinuation',true/);
  assert.match(p7, /'requirementClockHistory',true/);
  assert.match(p7, /'workerDayActionability',true/);
  assert.match(p7, /'principalMembrane',true/);
});

test("P7 keeps requirement existence upstream of execution warrant", () => {
  assert.match(p7, /crop_cycle_requirement_snapshot_v1/);
  assert.match(p7, /consequence_role='operation_requirement'/);
  assert.match(p7, /crop_operation_execution_warrant_v1/);
  assert.match(p7, /not coalesce\(\(r\.warrant->>'executionReady'\)::boolean,false\)/);
  assert.match(p7, /child\.source_requirement_instance_id=r\.id/);
  assert.match(p7, /'blockedExecutionDoesNotEraseRequirement',true/);
});

test("P7 audits gap causality, lawful custody, and one active acquisition path", () => {
  assert.match(p7, /consequence_role='truth_acquisition'/);
  assert.match(p7, /truth_acquisition_jurisdiction_v1/);
  assert.match(p7, /source_requirement_instance_id/);
  assert.match(p7, /carrier_task_id/);
  assert.match(p7, /atlas\.worker_day_cues/);
  assert.match(p7, /having count\(\*\)>1/);
  assert.match(p7, /'oneGapHasOneActiveAcquisitionPath',true/);
});

test("P7 detects partial-history living bodies without requiring a perfect profile lineage", () => {
  assert.match(p7, /crop_cycle_biological_progression_state_v1/);
  assert.match(p7, /profilePresent/);
  assert.match(p7, /not coalesce\(\(ce\.snapshot->>'profilePresent'\)::boolean,false\)/);
  assert.match(p7, /not coalesce\(\(ce\.biological->>'applicable'\)::boolean,false\)/);
  assert.match(p7, /'missingProfileCannotExcuseMissingCurrentRequirement',true/);
});

test("P7 audits requirement-clock reset from append-only release history", () => {
  assert.match(p7, /atlas\.state_consequence_events/);
  assert.match(p7, /e\.event_kind='released'/);
  assert.match(p7, /earliest_recorded_requirement_date/);
  assert.match(p7, /coalesce\(r\.requirement_onset_date,r\.requirement_known_active_by\)>h\.earliest_recorded_requirement_date/);
  assert.match(p7, /'requirementTimeCannotBeResetByGapResolution',true/);
});

test("P7 preserves the authenticated Worker Day boundary while auditing actionability", () => {
  // The first live migration used the canonical Worker Day reader. The corrective
  // migration deliberately rewrites that CTE rather than weakening its auth membrane.
  assert.match(p7, /worker_day_operational_task_cards_v3/);
  assert.match(workerBoundary, /worker_day_task_placements/);
  assert.match(workerBoundary, /atlas\.task_execution_readiness_v1/);
  assert.match(workerBoundary, /fm\.role='farm_hand'/);
  assert.match(workerBoundary, /t\.status='open'/);
  assert.doesNotMatch(workerBoundary, /grant execute on function atlas\.worker_day_operational_task_cards_v3/i);
  assert.doesNotMatch(workerBoundary, /auth\.uid\(\)\s+is\s+null/i);
});

test("P7 requires unresolved decisions to expose their source requirement and missing truth", () => {
  assert.match(p7, /t\.metadata->>'requirement_statement'/);
  assert.match(p7, /t\.metadata->>'missing_truth_statement'/);
  assert.match(p7, /source_requirement_instance_id/);
});

test("P7 audits false Principal escalation without generating one", () => {
  assert.match(p7, /e\.source_system='farm_reality'/);
  assert.match(p7, /e\.source_type='bell_repair_packet'/);
  assert.match(p7, /owningFunction,jurisdiction/);
  assert.match(p7, /'principalEscalationRequiresOwnershipMembraneCrossing',true/);
  assert.match(p7, /'principalEscalationCreated',false/);
  assert.doesNotMatch(p7, /insert\s+into\s+atlas\.operational_escalations/i);
});

test("P7 remains an auditor rather than a domain-state mutation engine", () => {
  assert.doesNotMatch(p7, /insert\s+into\s+atlas\.(tasks|state_consequence_instances|worker_day_cues|crop_cycles)/i);
  assert.doesNotMatch(p7, /update\s+atlas\.(tasks|state_consequence_instances|worker_day_cues|crop_cycles)/i);
  assert.doesNotMatch(p7, /delete\s+from\s+atlas\.(tasks|state_consequence_instances|worker_day_cues|crop_cycles)/i);
  assert.match(p7, /'auditDoesNotMutateDomainTruth',true/);
});

test("P7 preserves the old farm auditor internally and upgrades the existing v9 surface", () => {
  assert.match(p7, /rename to farm_continuity_audit_pre_p7_v9/);
  assert.match(p7, /create or replace function atlas\.farm_continuity_audit_v10/);
  assert.match(p7, /v_req:=atlas\.requirement_continuity_audit_v1/);
  assert.match(p7, /'requirementContinuity',v_req/);
  assert.match(p7, /'requirementTruthAcquisitionExecution','requirement_continuity_audit_v1'/);
  assert.match(p7, /create or replace function atlas\.farm_continuity_audit_v9/);
  assert.match(p7, /return atlas\.farm_continuity_audit_v10\(p_farm_id,p_as_of_date\)/);
});

test("P7 keeps the low-level requirement auditor service-internal", () => {
  assert.match(
    p7,
    /revoke all on function atlas\.requirement_continuity_audit_v1\(uuid,date\) from public,anon,authenticated/,
  );
  assert.match(
    p7,
    /grant execute on function atlas\.requirement_continuity_audit_v1\(uuid,date\) to service_role/,
  );
});
