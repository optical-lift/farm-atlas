import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901012600_atlas_person_goal_claim_count_v1.sql",
    import.meta.url,
  ),
  "utf8",
);

const candidateLoopStart = migration.indexOf("for v_candidate in");
const countShortCircuit = migration.indexOf(
  "if v_requirement_kind='claim_count' then\n          continue;",
);
const thresholdValueRead = migration.indexOf(
  "if jsonb_typeof(v_candidate.value #> v_value_path)<>'number' then",
);
const countSourceStart = migration.indexOf(
  "'source',case when v_requirement_kind='claim_count' then",
);
const thresholdSourceStart = migration.indexOf(
  "      else\n        jsonb_strip_nulls(jsonb_build_object(\n          'resolver','atlas.resolve_person_goal_requirement_results_v1',",
  countSourceStart,
);
const countSourceBranch = migration.slice(countSourceStart, thresholdSourceStart);

test("claim_count is a first-class reducer without threshold path or unit requirements", () => {
  assert.match(
    migration,
    /v_requirement_kind not in \('claim_threshold','claim_count'\)/,
  );
  assert.match(
    migration,
    /if v_requirement_kind='claim_count' then[\s\S]*jsonb_typeof\(v_criterion->'value'\)<>'number'[\s\S]*v_operator<>'>='/,
  );
  assert.match(
    migration,
    /else[\s\S]*jsonb_typeof\(v_criterion->'path'\)<>'array'[\s\S]*v_expected_unit := nullif\(btrim\(v_criterion->>'unit'\),'\'\'\)/,
  );
});

test("claim_count reduces only the already-governed current Claim candidate set", () => {
  assert.ok(candidateLoopStart >= 0);
  assert.match(
    migration.slice(candidateLoopStart),
    /c\.scope_kind='person'[\s\S]*c\.scope_id=p_owner_user_id[\s\S]*c\.subject_domain=v_selector_domain[\s\S]*c\.subject_kind=v_selector_kind[\s\S]*c\.subject_id=v_selector_id[\s\S]*c\.claim_type=v_selector_claim_type/,
  );
  assert.match(
    migration.slice(candidateLoopStart),
    /c\.lifecycle_state not in \('superseded','expired'\)[\s\S]*jsonb_array_elements_text\(v_lifecycle_states\)[\s\S]*jsonb_array_elements_text\(v_authority_kinds\)/,
  );
  assert.ok(countShortCircuit > candidateLoopStart);
  assert.ok(thresholdValueRead > countShortCircuit);
});

test("claim_count exposes canonical counted-set progress states", () => {
  assert.match(
    migration,
    /when v_candidate_count>=v_threshold then 'satisfied'[\s\S]*when v_candidate_count>0 then 'partial'[\s\S]*else 'unmet'/,
  );
  assert.match(migration, /'observedCount',v_candidate_count/);
  assert.match(migration, /'targetCount',[\s\S]*v_threshold/);
  assert.match(migration, /'operator',[\s\S]*v_operator/);
});

test("claim_count uses aggregate provenance instead of naming one Claim as satisfier", () => {
  assert.ok(countSourceStart >= 0);
  assert.ok(thresholdSourceStart > countSourceStart);
  assert.match(countSourceBranch, /'basis','current_claim_evidence'/);
  assert.match(countSourceBranch, /'matchingClaimCount',[\s\S]*v_candidate_count/);
  assert.doesNotMatch(countSourceBranch, /'claimId'/);
  assert.doesNotMatch(countSourceBranch, /'evidenceId'/);
});

test("claim_count migration does not widen Rhythm occurrence capture", () => {
  assert.doesNotMatch(migration, /record_person_rhythm_occurrence_api_v1/);
});
