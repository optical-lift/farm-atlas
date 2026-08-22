import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");

const model = readMigration("20260822231751_campaign_market_fit_prior_model_v1.sql");
const prospectiveGuard = readMigration("20260822231810_campaign_market_fit_prior_prospective_guard_v1.sql");
const authority = readMigration("20260822220716_intelligence_confidence_abstention_authority_v1.sql");

const coefficientBlock = model.match(/cross join \(values([\s\S]*?)\) as x\(feature_key,feature_value,coefficient,rationale\)/i)?.[1] ?? "";

test("market-fit v1.0 is explicitly a preregistered uncalibrated prior", () => {
  assert.match(model, /'campaign_market_fit_prior','1\.0\.0','market_fit','campaign_target_selection','market_fit'/i);
  assert.match(model, /'preregistered_logistic_prior','campaign_market_fit_features_v1',0,'uncalibrated_prior'/i);
  assert.match(model, /prospective prior probability estimate produced by a frozen logistic specification before outcome calibration/i);
  assert.match(model, /not empirical calibration and does not itself authorize action/i);
  assert.match(model, /coefficient_origin','governance_prior_not_fitted_to_outcomes'/i);
});

test("released model versions and coefficients are immutable specifications", () => {
  assert.match(model, /create table if not exists local_intel\.intelligence_model_versions/i);
  assert.match(model, /create table if not exists local_intel\.intelligence_model_coefficients/i);
  assert.match(model, /released intelligence model specifications are append-only/i);
  assert.match(model, /before update or delete on local_intel\.intelligence_model_versions/i);
  assert.match(model, /before update or delete on local_intel\.intelligence_model_coefficients/i);
});

test("v1.0 uses only upstream market-fit evidence", () => {
  assert.match(model, /qualification_snapshot->>'research_warrant'/i);
  assert.match(model, /qualification_snapshot->>'external_space_fit_state'/i);
  assert.match(model, /qualification_snapshot->>'workforce_scale_summary'/i);
  assert.match(coefficientBlock, /'research_warrant'/i);
  assert.match(coefficientBlock, /'external_space_fit_state'/i);
  assert.match(coefficientBlock, /'workforce_scale_summary'/i);
});

test("legacy ranking and outreach actionability cannot become hidden market-fit features", () => {
  for (const excluded of [
    "rank_score",
    "qualification_tier",
    "marketing_clearance_state",
    "organizer_resolution_state",
    "buyer_context_snapshot",
  ]) {
    assert.doesNotMatch(coefficientBlock, new RegExp(`'${excluded}'`, "i"));
  }
  assert.match(model, /'rank_score','qualification_tier','marketing_clearance_state','organizer_resolution_state','buyer_context_snapshot'/i);
  assert.match(model, /Downstream ranking summaries and outreach\/actionability fields are not market-fit evidence/i);
  assert.match(model, /legacy_rank_score_excluded',true/i);
  assert.match(model, /marketing_clearance_excluded_from_market_fit',true/i);
  assert.match(model, /organizer_resolution_excluded_from_market_fit',true/i);
});

test("probabilities come from a frozen logistic transform instead of relabeling rank score", () => {
  assert.match(model, /v_lp := v_intercept \+ v_research_c \+ v_space_c \+ v_scale_c/i);
  assert.match(model, /1\.0 \/ \(1\.0 \+ exp\(\(-1\.0 \* v_lp\)::double precision\)\)/i);
  assert.match(model, /'__intercept__','\*',-1\.00::numeric/i);
  assert.match(model, /'external_space_fit_state','direct_external_space_fit',1\.25::numeric/i);
  assert.match(model, /'external_space_fit_state','strong_self_supply_signal',-1\.20::numeric/i);
  assert.match(model, /'workforce_scale_summary','250_plus',0\.50::numeric/i);
});

test("unknown feature values fail closed rather than receiving an invented zero weight", () => {
  assert.match(model, /v_unmapped := v_unmapped \|\| jsonb_build_array/i);
  assert.match(model, /if jsonb_array_length\(v_unmapped\)=0 then/i);
  assert.match(model, /v_probability := null/i);
  assert.match(model, /v_class := 'unscored'/i);
  assert.match(model, /'scoring_state',case when v_probability is null then 'unsupported_feature_contract' else 'scored' end/i);
});

test("new campaign targets are prospectively snapshotted by v1.0", () => {
  assert.match(model, /create or replace function local_intel\.capture_new_campaign_target_decision_v1\(\)/i);
  assert.match(model, /perform local_intel\.capture_campaign_target_market_fit_v1_0\(new\.id\)/i);
  assert.match(model, /'campaign_market_fit_prior','1\.0\.0','market_fit'/i);
  assert.match(model, /v_score->>'predicted_class',v_probability,null,v_recommendation/i);
  assert.match(model, /Prospective market-fit prior estimate only/i);
});

test("v1.0 cannot be applied retroactively even through its internal writer", () => {
  assert.match(model, /retroactive_application_allowed boolean not null default false/i);
  assert.match(prospectiveGuard, /m\.retroactive_application_allowed=false and t\.created_at < m\.effective_from/i);
  assert.match(prospectiveGuard, /is prospective-only; target % predates model release/i);
  assert.match(prospectiveGuard, /'model_effective_from',m\.effective_from/i);
});

test("historical campaign decisions stay on their original unversioned path", () => {
  assert.match(model, /if v_effective_from is not null and t\.created_at >= v_effective_from then[\s\S]*capture_campaign_target_market_fit_v1_0/i);
  assert.match(model, /v_stable_key := 'campaign_target:' \|\| t\.id::text \|\| ':market_fit:v1'/i);
  assert.match(model, /coalesce\(nullif\(t\.metadata->>'ranking_model_version',''\),'unversioned'\)/i);
  assert.doesNotMatch(model, /update\s+local_intel\.intelligence_decisions[\s\S]*campaign_market_fit_prior/i);
});

test("shadow scoring is clearly non-decision analysis", () => {
  assert.match(model, /create or replace view local_intel\.v_campaign_market_fit_prior_shadow_v1/i);
  assert.match(model, /true as shadow_only/i);
  assert.match(model, /false as is_prospective_decision/i);
  assert.match(model, /shadow_predicted_probability/i);
});

test("a fresh probability still cannot authorize automation before outcome calibration", () => {
  assert.match(model, /training_outcome_count,0/i);
  assert.match(model, /'uncalibrated_prior'/i);
  assert.match(authority, /elsif v_model_scorable < p\.min_model_scorable_outcomes then[\s\S]*v_state := 'human_review'[\s\S]*v_reason := 'insufficient_domain_model_outcomes'/i);
  assert.match(authority, /elsif d\.predicted_probability >= p\.min_probability_for_act then[\s\S]*v_state := 'act'/i);
});

test("model internals stay behind the private local-intel membrane", () => {
  assert.match(model, /revoke all on local_intel\.intelligence_model_versions from public,anon,authenticated/i);
  assert.match(model, /revoke all on local_intel\.intelligence_model_coefficients from public,anon,authenticated/i);
  assert.match(model, /revoke execute on function local_intel\.capture_campaign_target_market_fit_v1_0\(uuid\) from public,anon,authenticated,service_role/i);
  assert.match(prospectiveGuard, /revoke execute on function local_intel\.capture_campaign_target_market_fit_v1_0\(uuid\) from public,anon,authenticated,service_role/i);
  assert.doesNotMatch(model, /grant\s+usage\s+on\s+schema\s+local_intel/i);
});
