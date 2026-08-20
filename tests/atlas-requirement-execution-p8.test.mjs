import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const releaseSql = readFileSync(
  "supabase/migrations/20260820004459_p8_requirement_warrant_execution_release_v1.sql",
  "utf8",
);
const resultSql = readFileSync(
  "supabase/migrations/20260820004725_p8_crop_requirement_transplant_result_v1.sql",
  "utf8",
);
const clockSql = readFileSync(
  "supabase/migrations/20260820004938_p8_requirement_clock_preserve_on_resolution_v4.sql",
  "utf8",
);
const varietySql = readFileSync(
  "supabase/migrations/20260820004952_p8_unknown_variety_remains_unknown_v5.sql",
  "utf8",
);
const identitySql = readFileSync(
  "supabase/migrations/20260820005042_p8_transplant_result_identity_cleanup_v6.sql",
  "utf8",
);
const p8Sql = [releaseSql, resultSql, clockSql, varietySql, identitySql].join("\n");

test("P8 releases physical execution only after the source requirement has a ready warrant", () => {
  assert.match(releaseSql, /create or replace function atlas\.ensure_requirement_execution_v1/);
  assert.match(releaseSql, /crop_operation_execution_warrant_v1\(v_cycle\.id,'transplant',v_req\.id\)/);
  assert.match(releaseSql, /if not coalesce\(\(v_warrant->>'executionReady'\)::boolean,false\) then/);
  assert.match(releaseSql, /'state','warrant_not_ready'/);
  assert.match(releaseSql, /materialize_specific_work_occurrence_v1/);
  assert.match(releaseSql, /'executionReleasedOnlyAfterReadyWarrant',true/);
});

test("P8 uses the universal occurrence engine instead of a parallel transplant task system", () => {
  assert.match(releaseSql, /atlas\.plan_work_occurrence_v1/);
  assert.match(releaseSql, /p_source_kind=>'state_consequence_requirement'/);
  assert.match(releaseSql, /p_source_id=>v_req\.id/);
  assert.match(releaseSql, /p_definition_key=>'requirement-operation:crop-cycle:transplant'/);
  assert.match(releaseSql, /p_policy_key=>'requirement-operation:crop-cycle:transplant:one-active'/);
  assert.match(releaseSql, /p_maximum_active_instances=>1/);
  assert.doesNotMatch(releaseSql, /insert\s+into\s+atlas\.tasks/i);
});

test("P8 preserves execution custody and fails closed rather than guessing a worker", () => {
  assert.match(releaseSql, /create or replace function atlas\.requirement_execution_assignee_v1/);
  assert.match(releaseSql, /v_cycle\.source_task_id is not null/);
  assert.match(releaseSql, /fm\.active=true and fm\.role='farm_hand'/);
  assert.match(releaseSql, /if v_count=1 then/);
  assert.match(releaseSql, /when v_count>1 then 'ambiguous'/);
  assert.match(releaseSql, /'executorIsNotGuessedWhenAmbiguous',true/);
  assert.match(releaseSql, /'sourceExecutionCustodyPrecedesFallback',true/);
  assert.match(releaseSql, /'ownerDecisionCustodyDoesNotBecomeWorkerExecutionCustody',true/);
});

test("P8 worker execution is required persistent work but its release date is not requirement onset", () => {
  assert.match(releaseSql, /'visibility_scope','assigned_worker'/);
  assert.match(releaseSql, /'work_lane','required'/);
  assert.match(releaseSql, /'commitment_kind','persistent'/);
  assert.match(releaseSql, /'due_date_semantics','execution_release_date_not_requirement_onset'/);
  assert.match(releaseSql, /'requirement_known_active_by',v_req\.requirement_known_active_by/);
  assert.match(releaseSql, /'requirement_onset_date',v_req\.requirement_onset_date/);
  assert.match(releaseSql, /'taskDueDateDoesNotResetRequirementClock',true/);
});

test("P8 destination acquisition resolution closes the decision carrier and re-evaluates execution", () => {
  assert.match(releaseSql, /create or replace function atlas\.reconcile_resolved_truth_acquisition_to_execution_v1/);
  assert.match(releaseSql, /new\.consequence_role<>'truth_acquisition'/);
  assert.match(releaseSql, /new\.source_requirement_instance_id is null/);
  assert.match(releaseSql, /record_task_transition_v1_internal/);
  assert.match(releaseSql, /'canonical_truth_acquisition_resolution'/);
  assert.match(releaseSql, /ensure_requirement_execution_v1\(/);
  assert.match(releaseSql, /after update of status on atlas\.state_consequence_instances/);
});

test("P8 structured transplant result requires witnessed physical facts", () => {
  assert.match(resultSql, /create or replace function atlas\.record_crop_requirement_transplant_result_v1/);
  assert.match(resultSql, /p_planted_amount is null or p_planted_amount<=0/);
  assert.match(resultSql, /p_destination_object_id is null/);
  assert.match(resultSql, /p_all_remaining_transplanted is null/);
  assert.match(resultSql, /p_planted_date<>v_today/);
  assert.match(resultSql, /crop_destination_claims/);
  assert.match(resultSql, /crop_operation_execution_warrant_v1/);
  assert.match(resultSql, /record_task_transition_v1_internal/);
  assert.match(resultSql, /'plantedAmount',p_planted_amount/);
  assert.match(resultSql, /'plantedObjectId',p_destination_object_id/);
});

test("P8 closes the source seedling body only when all remaining starts are explicitly witnessed as moved", () => {
  assert.match(resultSql, /if p_all_remaining_transplanted then/);
  assert.match(resultSql, /cycle_state='transplanted_out'/);
  assert.match(resultSql, /lifecycle_status='complete'/);
  assert.match(resultSql, /coverage_kind='seedlings_remaining'/);
  assert.match(resultSql, /coverage_amount=0/);
  assert.match(resultSql, /'remaining_quantity_state','unknown_until_observed'/);
  assert.match(resultSql, /'partialTransferDoesNotInventRemainingCount',true/);
  assert.match(resultSql, /'allRemainingFlagControlsSourceCycleClosure',true/);
});

test("P8 derives destination living state from canonical planting evidence and evaluates what comes next", () => {
  assert.match(resultSql, /sync_crop_cycle_registry_v1/);
  assert.match(resultSql, /where object_content_id=v_content_id/);
  assert.match(resultSql, /'creates','confirmed','crop_requirement_transplant_result_v1'/);
  assert.match(resultSql, /reconcile_crop_cycle_requirement_state_v1\(v_source_cycle\.id\)/);
  assert.match(resultSql, /crop_cycle_requirement_snapshot_v1\(v_destination_cycle_id,v_today\)/);
  assert.match(resultSql, /'destinationCycleIsDerivedFromCanonicalPlantingEvidence',true/);
  assert.match(resultSql, /'nextBiologicalContinuationIsEvaluated',true/);
});

test("P8 requirement clock survives resolution and can only move earlier with stronger evidence", () => {
  assert.match(clockSql, /if tg_op='UPDATE' then/);
  assert.match(clockSql, /when v_candidate_onset is null then old\.requirement_onset_date/);
  assert.match(clockSql, /least\(old\.requirement_onset_date,v_candidate_onset\)/);
  assert.match(clockSql, /when v_candidate_known_active_by is null then old\.requirement_known_active_by/);
  assert.match(clockSql, /least\(old\.requirement_known_active_by,v_candidate_known_active_by\)/);
  assert.match(clockSql, /coalesce\(v_candidate_time_class,old\.requirement_time_class\)/);
  assert.match(clockSql, /coalesce\(old\.epistemic_basis,'\{\}'::jsonb\)\|\|v_candidate_basis/);
});

test("P8 keeps unknown crop identity unknown instead of promoting task display text into cultivar truth", () => {
  assert.match(varietySql, /if v_source_cycle\.variety is null then/);
  assert.match(varietySql, /update atlas\.planting_claims set variety=null/);
  assert.match(varietySql, /update atlas\.object_contents set variety=null/);
  assert.match(identitySql, /'variety',v_source_cycle\.variety/);
  assert.match(identitySql, /set variety=v_source_cycle\.variety/);
  assert.match(identitySql, /identity_normalized_from_source_crop_cycle/);
  assert.match(identitySql, /'summary','Planted '\|\|p_planted_amount::text\|\|' plants '\|\|v_identity_label/);
});

test("P8 is generic crop-transplant architecture, not a hardcoded Strawflower or Anna repair", () => {
  assert.doesNotMatch(p8Sql, /Strawflower/i);
  assert.doesNotMatch(p8Sql, /\bAnna\b/i);
  assert.doesNotMatch(p8Sql, /\bLex\b/i);
  assert.doesNotMatch(p8Sql, /\bMG8\b/i);
  assert.doesNotMatch(p8Sql, /8f0b9189|23e98e5e|5c3eced6|82c66e5c/i);
});

test("P8 does not manufacture a duplicate Owner obligation", () => {
  assert.doesNotMatch(p8Sql, /insert\s+into\s+atlas\.owner_obligations/i);
  assert.doesNotMatch(p8Sql, /insert\s+into\s+atlas\.operational_escalations/i);
});

test("P8 internal release and result helpers remain service-only", () => {
  for (const signature of [
    "requirement_execution_assignee_v1\\(uuid\\)",
    "ensure_requirement_execution_v1\\(uuid,date\\)",
    "record_crop_requirement_transplant_result_v1\\(uuid,uuid,date,numeric,uuid,boolean,text,text\\)",
  ]) {
    const pattern = new RegExp(`revoke all on function atlas\\.${signature} from public,anon,authenticated`);
    assert.match(p8Sql, pattern);
  }
  assert.match(releaseSql, /grant execute on function atlas\.requirement_execution_assignee_v1\(uuid\) to service_role/);
  assert.match(releaseSql, /grant execute on function atlas\.ensure_requirement_execution_v1\(uuid,date\) to service_role/);
  assert.match(resultSql, /grant execute on function atlas\.record_crop_requirement_transplant_result_v1\(uuid,uuid,date,numeric,uuid,boolean,text,text\) to service_role/);
});
