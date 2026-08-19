import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase8 = readFileSync(
  "supabase/migrations/20260818031602_reality_expression_real_operation_explanation_v1.sql",
  "utf8",
);
const objectKeyFix = readFileSync(
  "supabase/migrations/20260818031629_real_operation_explanation_object_key_fix_v1.sql",
  "utf8",
);

test("Phase 8 exposes a read-only real-operation explanation contract", () => {
  assert.match(
    phase8,
    /create or replace function atlas\.real_operation_explanation_v1\(\s*p_transition_id uuid\s*\)/i,
  );
  assert.match(phase8, /\bstable security definer\b/i);
  assert.match(phase8, /active farm membership required/i);
  assert.match(phase8, /historical_event_reconstruction/i);
  assert.match(phase8, /currentRowsAreNotBackdated/i);
  assert.match(phase8, /missingResultFieldsAreNotInvented/i);
});

test("Phase 8 compares every master-build real-operation dimension", () => {
  for (const token of [
    "predictedBeforeState",
    "expectedMove",
    "actualEvidence",
    "afterState",
    "claimMovement",
    "reforecast",
    "nextOperation",
    "visibleEffects",
  ]) {
    assert.match(phase8, new RegExp(token, "i"));
  }
});

test("historical Done is evidence rather than retroactive complete fruit", () => {
  assert.match(phase8, /historicalTransitionIsEvidenceNotCompleteFruit/i);
  assert.match(phase8, /required_result_evidence_not_captured/i);
  assert.match(phase8, /structuredOperationActualCount/i);
  assert.match(
    phase8,
    /does not retroactively prove missing quantities, minutes, claims, spatial geometry, or other result fields/i,
  );
});

test("task-required fruit stays separate from the historical completion claim", () => {
  assert.match(phase8, /execution_done_when/i);
  assert.match(phase8, /worker_result_lines/i);
  assert.match(phase8, /requiredResultEvidence/i);
  assert.match(phase8, /resultEvidenceCaptureState/i);
  assert.match(phase8, /allSubjectsHaveContinuation/i);
});

test("claim movement and Production reforecast remain evidence-gated", () => {
  assert.match(
    phase8,
    /historical_claim_movement_not_reconstructable_from_available_event_evidence/i,
  );
  assert.match(phase8, /unrepresentedClaimMovementIsNotInferred/i);
  assert.match(phase8, /not_evaluable_no_production_lot_provenance/i);
  assert.match(phase8, /productionReforecastRequiresProductionLotProvenance/i);
  assert.match(phase8, /production_lot_reforecast_preview_v1/i);
});

test("continuation, Workflow, Journal, Bell, and Principal jurisdiction stay distinct", () => {
  assert.match(phase8, /crop_cycle_reality_expression_v4/i);
  assert.match(phase8, /taskCompletionIsNotContinuationProof/i);
  assert.match(phase8, /workflow_events/i);
  assert.match(phase8, /journal_event_index/i);
  assert.match(phase8, /bell_event_is_worthy_v1/i);
  assert.match(phase8, /principalEscalationIsSeparateJurisdiction/i);
  assert.match(phase8, /escalationCreatedByThisContract',false/i);
});

test("Phase 8 explanation does not mutate farm truth", () => {
  assert.doesNotMatch(
    phase8,
    /\b(insert\s+into|update|delete\s+from)\s+atlas\.(tasks|task_transitions|task_outcome_events|workflow_events|journal_event_index|crop_cycles|crop_placements|planting_claims|production_lots|production_operation_actuals|worker_day_task_placements)\b/i,
  );
});

test("the live growing_objects key correction is preserved in source history", () => {
  assert.match(objectKeyFix, /go\.object_key/i);
  assert.match(objectKeyFix, /go\.stable_key as object_key/i);
  assert.match(objectKeyFix, /pg_get_functiondef/i);
});

test("Phase 8 RPC registry records the explanation-only boundary", () => {
  assert.match(phase8, /atlas\.real_operation_explanation_v1\(uuid\)/i);
  assert.match(phase8, /'app_endpoint','verified','active'/i);
  assert.match(phase8, /This is an explanation\/replay surface, not a second result writer/i);
  assert.match(phase8, /grant execute on function atlas\.real_operation_explanation_v1\(uuid\) to authenticated/i);
  assert.match(phase8, /grant execute on function atlas\.real_operation_explanation_v1\(uuid\) to service_role/i);
});