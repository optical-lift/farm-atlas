import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const authority = readMigration("20260822220716_intelligence_confidence_abstention_authority_v1.sql");
const indexes = readMigration("20260822221043_intelligence_confidence_abstention_fk_index_v1.sql");

test("intelligence competence is explicitly domain-scoped rather than borrowed across models", () => {
  assert.match(authority, /create table if not exists local_intel\.intelligence_competence_domains/i);
  assert.match(authority, /create table if not exists local_intel\.intelligence_decision_domain_map/i);
  assert.match(authority, /'campaign_target_selection','market_fit','market_fit'/i);
  assert.match(authority, /competence must be learned in this domain rather than borrowed from identity or source-resolution accuracy/i);
});

test("authority thresholds are versioned governance policy and not presented as empirical truth", () => {
  assert.match(authority, /policy_version text not null/i);
  assert.match(authority, /'market_fit','1\.0',true,true,true,true/i);
  assert.match(authority, /30,20,8/i);
  assert.match(authority, /0\.75,0\.18,0\.10/i);
  assert.match(authority, /0\.85,0\.60/i);
  assert.match(authority, /thresholds are policy, not empirical truth/i);
  assert.match(authority, /later versioned policy after real outcome calibration exists/i);
});

test("authority has four distinct outcomes instead of forcing every recommendation into action", () => {
  assert.match(authority, /permission_state in \('act','human_review','research_first','abstain'\)/i);
  assert.match(authority, /v_state := 'act'/i);
  assert.match(authority, /v_state := 'human_review'/i);
  assert.match(authority, /v_state := 'research_first'/i);
  assert.match(authority, /v_state := 'abstain'/i);
});

test("missing governance inputs require research before automation", () => {
  assert.match(authority, /lower\(d\.model_version\)='unversioned'/i);
  assert.match(authority, /v_reason := 'model_version_not_governed'/i);
  assert.match(authority, /v_reason := 'predicted_probability_missing'/i);
  assert.match(authority, /v_reason := 'decision_evidence_snapshot_empty'/i);
  assert.match(authority, /issue_versioned_prediction_before_automation/i);
  assert.match(authority, /produce_probability_bearing_prediction/i);
  assert.match(authority, /capture_decision_evidence_before_action/i);
});

test("automation requires real model and local probability-band calibration", () => {
  assert.match(authority, /v_model_scorable < p\.min_model_scorable_outcomes/i);
  assert.match(authority, /v_model_probability_scored < p\.min_model_probability_scored_outcomes/i);
  assert.match(authority, /v_bucket_count < p\.min_bucket_probability_outcomes/i);
  assert.match(authority, /v_directional_accuracy < p\.min_directional_accuracy/i);
  assert.match(authority, /v_mean_brier > p\.max_mean_brier_score/i);
  assert.match(authority, /v_bucket_gap > p\.max_bucket_calibration_gap/i);
  assert.match(authority, /abs\(avg\(e\.predicted_probability\)-avg\(e\.observed_score\)\).*calibration_gap/is);
});

test("probability controls permission only after calibration gates pass", () => {
  assert.match(authority, /d\.predicted_probability >= p\.min_probability_for_act[\s\S]+v_state := 'act'/i);
  assert.match(authority, /d\.predicted_probability >= p\.min_probability_for_human_review[\s\S]+v_state := 'human_review'/i);
  assert.match(authority, /predicted_probability_below_review_threshold/i);
  assert.match(authority, /machine_execution_allowed',\(v_state='act'\)/i);
});

test("source reliability stays a separate signal and cannot masquerade as outcome calibration", () => {
  assert.match(authority, /source_reliability_integration_state','separate_signal_not_silently_substituted_for_outcome_calibration'/i);
  assert.doesNotMatch(authority, /v_source_reliability_profile_v1/i);
  assert.doesNotMatch(authority, /source_reliability_assessments/i);
});

test("authority decisions are append-only snapshots", () => {
  assert.match(authority, /create table if not exists local_intel\.intelligence_authority_assessments/i);
  assert.match(authority, /intelligence_authority_assessments is append-only/i);
  assert.match(authority, /before update or delete on local_intel\.intelligence_authority_assessments/i);
  assert.match(authority, /thresholds_snapshot jsonb not null/i);
  assert.match(authority, /evidence_snapshot jsonb not null/i);
});

test("every intelligence action carries an authority assessment", () => {
  assert.match(authority, /add column if not exists authority_assessment_id uuid references local_intel\.intelligence_authority_assessments/i);
  assert.match(authority, /alter column authority_assessment_id set not null/i);
  assert.match(authority, /record_intelligence_authority_assessment_v1\(/i);
  assert.match(authority, /'system_authority',v_gate,'actor_execution_class',v_actor_class/i);
});

test("machine execution is blocked unless the gate explicitly permits action", () => {
  assert.match(authority, /v_action_state='executed' and v_actor_class='machine'/i);
  assert.match(authority, /machine_execution_allowed'\)::boolean,false\)=false/i);
  assert.match(authority, /Machine execution not authorized/i);
});

test("human action remains recordable without turning human judgment into machine authority", () => {
  assert.match(authority, /when lower\(v_actor_kind\) in \('human','operator','owner','principal','staff','worker'\) then 'human'/i);
  assert.match(authority, /v_action_state='executed' and v_actor_class='machine'/i);
  assert.doesNotMatch(authority, /v_action_state='executed' and v_actor_class='human'.*raise exception/is);
  assert.match(authority, /requested_actor_kind/i);
  assert.match(authority, /actor_execution_class/i);
});

test("callers cannot bypass the governed writer with direct table inserts", () => {
  assert.match(authority, /revoke insert,update,delete on local_intel\.intelligence_actions from service_role/i);
  assert.match(authority, /revoke insert,update,delete on local_intel\.intelligence_authority_assessments from service_role/i);
  assert.match(authority, /grant execute on function local_intel\.record_intelligence_action_v1\(jsonb\) to service_role/i);
  assert.match(authority, /grant execute on function local_intel\.get_intelligence_decision_authority_v1\(uuid,text\) to service_role/i);
  assert.match(authority, /revoke execute on function local_intel\.record_intelligence_action_v1\(jsonb\) from public, anon, authenticated/i);
  assert.match(authority, /revoke execute on function local_intel\.get_intelligence_decision_authority_v1\(uuid,text\) from public, anon, authenticated/i);
});

test("the private local-intel membrane is not widened to make client access convenient", () => {
  assert.doesNotMatch(authority, /grant\s+usage\s+on\s+schema\s+local_intel/i);
  assert.match(authority, /revoke all on local_intel\.v_intelligence_decision_authority_v1 from public, anon, authenticated/i);
  assert.match(authority, /revoke all on local_intel\.v_intelligence_abstention_queue_v1 from public, anon, authenticated/i);
});

test("new decision-domain foreign key has an explicit supporting index", () => {
  assert.match(indexes, /create index if not exists intelligence_decision_domain_map_domain_key_idx/i);
  assert.match(indexes, /on local_intel\.intelligence_decision_domain_map\(domain_key\)/i);
});
