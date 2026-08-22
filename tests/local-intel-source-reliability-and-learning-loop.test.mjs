import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const reliability = readMigration("20260822195024_source_empirical_reliability_learning_v1.sql");
const loop = readMigration("20260822195212_intelligence_action_outcome_learning_loop_v1.sql");
const membrane = readMigration("20260822195250_intelligence_learning_write_membrane_v1.sql");

test("source reliability learns by claim family and separates accuracy, currency, and completeness", () => {
  assert.match(reliability, /source_reliability_claim_families/i);
  assert.match(reliability, /source_reliability_claim_kind_map/i);
  assert.match(reliability, /assessment_dimension in \('accuracy','currency','completeness'\)/i);
  assert.match(reliability, /claim_family_key text not null/i);
  assert.match(reliability, /subject_party_relationship text not null/i);
});

test("source reliability cannot grade a source from itself or from an unlinked claim", () => {
  assert.match(reliability, /Source % is not linked to claim % and cannot be graded for that claim/i);
  assert.match(reliability, /A source cannot independently confirm itself/i);
  assert.match(reliability, /independent_source basis requires independent_evidence_source_id/i);
  assert.match(reliability, /independent_evidence_source_id is null or independent_evidence_source_id <> source_id/i);
});

test("learned source reliability is conservative and does not silently rewrite authority classes", () => {
  assert.match(reliability, /\(2::numeric \+ sum\(a\.outcome_score\)\) \/ \(4::numeric \+ count\(\*\)\)/i);
  assert.match(reliability, /count\(\*\) < 5 then 'insufficient_sample'/i);
  assert.match(reliability, /eligible_for_confidence_adjustment/i);
  assert.match(reliability, /count\(\*\) >= 5/i);
  assert.doesNotMatch(reliability, /update\s+local_intel\.research_source_classes/i);
});

test("source reliability history is append-only and internal-only", () => {
  assert.match(reliability, /source_reliability_assessments is append-only/i);
  assert.match(reliability, /before update or delete on local_intel\.source_reliability_assessments/i);
  assert.match(reliability, /revoke execute on function local_intel\.record_source_reliability_assessment_v1[\s\S]+from public, anon, authenticated/i);
  assert.match(reliability, /grant execute on function local_intel\.record_source_reliability_assessment_v1[\s\S]+to service_role/i);
});

test("the intelligence loop freezes decisions before actions and outcomes", () => {
  assert.match(loop, /create table if not exists local_intel\.intelligence_decisions/i);
  assert.match(loop, /feature_snapshot jsonb not null/i);
  assert.match(loop, /evidence_snapshot jsonb not null/i);
  assert.match(loop, /issued_at timestamptz not null/i);
  assert.match(loop, /create table if not exists local_intel\.intelligence_actions/i);
  assert.match(loop, /create table if not exists local_intel\.intelligence_outcomes/i);
  assert.match(loop, /create table if not exists local_intel\.intelligence_learning_evaluations/i);
});

test("historical campaign targets are captured as predictions without inventing actions or outcomes", () => {
  assert.match(loop, /capture_campaign_target_decision_v1/i);
  assert.match(loop, /snapshot_origin','campaign_target'/i);
  assert.match(loop, /historical_probability_available/i);
  assert.match(loop, /for r in select id from local_intel\.campaign_targets loop perform local_intel\.capture_campaign_target_decision_v1\(r\.id\)/i);
  assert.doesNotMatch(loop, /insert into local_intel\.intelligence_actions[\s\S]+for r in select id from local_intel\.campaign_targets/i);
});

test("outcome scoring is policy-owned and ambiguous campaign responses stay unscored", () => {
  assert.match(loop, /intelligence_outcome_scoring_policies/i);
  assert.match(loop, /'booked',1\.00,'directly_scorable'/i);
  assert.match(loop, /'uses_own_facility',0\.10,'directly_scorable'/i);
  assert.match(loop, /'no_current_need',null,'context_required'/i);
  assert.match(loop, /'wrong_person',null,'context_required'/i);
  assert.match(loop, /'needs_pricing',null,'context_required'/i);
  assert.match(loop, /'opened',null,'operational_only'/i);
  assert.match(membrane, /from local_intel\.intelligence_outcome_scoring_policies/i);
  assert.doesNotMatch(membrane, /p_payload->>'outcome_score'/i);
});

test("real campaign response events automatically become governed learning outcomes", () => {
  assert.match(loop, /campaign_response_learning_bridge_v1/i);
  assert.match(loop, /after insert on local_intel\.campaign_response_events/i);
  assert.match(loop, /capture_campaign_response_outcome_v1/i);
  assert.match(loop, /perform local_intel\.evaluate_intelligence_outcome_v1\(v_outcome_id\)/i);
});

test("learning evaluations preserve calibration and directional correctness without rewriting the prediction", () => {
  assert.match(loop, /squared_error/i);
  assert.match(loop, /power\(d\.predicted_probability-o\.outcome_score,2\)/i);
  assert.match(loop, /direction_correct/i);
  assert.match(loop, /mean_brier_score/i);
  assert.match(loop, /directional_accuracy/i);
  assert.match(loop, /intelligence_decisions_append_only_v1/i);
  assert.match(loop, /intelligence_actions_append_only_v1/i);
  assert.match(loop, /intelligence_outcomes_append_only_v1/i);
  assert.match(loop, /intelligence_learning_evaluations_append_only_v1/i);
});

test("generic learning writes are service-only", () => {
  for (const fn of [
    "record_intelligence_decision_v1",
    "record_intelligence_action_v1",
    "record_intelligence_outcome_v1",
  ]) {
    assert.match(membrane, new RegExp(`revoke execute on function local_intel\\.${fn}\\(jsonb\\) from public, anon, authenticated`, "i"));
    assert.match(membrane, new RegExp(`grant execute on function local_intel\\.${fn}\\(jsonb\\) to service_role`, "i"));
  }
});
