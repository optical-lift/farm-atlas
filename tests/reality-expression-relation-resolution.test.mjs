import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const requirementsMigrationName =
  "20260817215657_reality_expression_relation_resolution_requirements_v1.sql";
const registryMigrationName =
  "20260817215729_reality_expression_resolution_rpc_registry_v1.sql";

const requirements = readFileSync(
  new URL(`../supabase/migrations/${requirementsMigrationName}`, import.meta.url),
  "utf8",
);
const registry = readFileSync(
  new URL(`../supabase/migrations/${registryMigrationName}`, import.meta.url),
  "utf8",
);

const requirementsFunction = requirements.match(
  /create or replace function atlas\.crop_cycle_relation_resolution_requirements_v1[\s\S]*?\$function\$;/,
)?.[0];

assert.ok(requirementsFunction, "Relation-resolution requirements function must exist");

test("Pass 1.2 stays read-only and service-internal", () => {
  assert.match(requirements, /stable\s+security invoker/i);
  assert.match(
    requirements,
    /revoke execute on function atlas\.crop_cycle_relation_resolution_requirements_v1\(uuid\) from authenticated;/i,
  );
  assert.match(
    requirements,
    /revoke execute on function atlas\.crop_cycle_reality_expression_v3\(uuid\) from authenticated;/i,
  );
  assert.match(
    requirements,
    /grant execute on function atlas\.crop_cycle_relation_resolution_requirements_v1\(uuid\) to service_role;/i,
  );
  assert.match(
    requirements,
    /grant execute on function atlas\.crop_cycle_reality_expression_v3\(uuid\) to service_role;/i,
  );
  assert.doesNotMatch(requirementsFunction, /\binsert\s+into\b/i);
  assert.doesNotMatch(requirementsFunction, /\bupdate\s+atlas\./i);
  assert.doesNotMatch(requirementsFunction, /\bdelete\s+from\b/i);
  assert.doesNotMatch(requirementsFunction, /\bperform\s+atlas\./i);
});

test("witnessing and adjudication stay separate", () => {
  assert.match(requirements, /'eligibility','active_farm_membership'/);
  assert.match(requirements, /'jurisdiction','owner'/);
  assert.match(requirements, /'jurisdiction','owner_or_manager'/);
  assert.match(
    requirements,
    /Truth may enter from any lawful witness role; witnessing does not transfer mutation or adjudication authority/,
  );
  assert.match(
    requirements,
    /A present\/absent observation is evidence\. It does not itself close, clear, supersede, or date the crop cycle/,
  );
});

test("the missing neutral witness channel is explicit", () => {
  assert.match(requirements, /'neutralRelationEvidenceIntake'/);
  assert.match(requirements, /'state','missing'/);
  assert.match(requirements, /'directAuthenticatedTableInsert',false/);
  assert.match(requirements, /'available_but_mutating'/);
  assert.match(requirements, /neutral_relation_evidence_intake_missing/);
  assert.match(
    requirements,
    /existing member crop-observation command mutates crop lifecycle state/,
  );
});

test("current member crop observation is never called as relation evidence", () => {
  assert.match(
    requirements,
    /atlas\.record_crop_observation_for_member_v1\(\.\.\.\)/,
  );
  assert.match(
    requirements,
    /must not be used as neutral evidence intake for an unresolved spatial relation/,
  );
  assert.doesNotMatch(
    requirementsFunction,
    /:=\s*atlas\.record_crop_observation_for_member_v1/i,
  );
  assert.doesNotMatch(
    requirementsFunction,
    /perform\s+atlas\.record_crop_observation_for_member_v1/i,
  );
});

test("FR13-class ambiguity decomposes into concrete evidence questions", () => {
  for (const key of [
    "subject_spatial_extent",
    "cooccupant_current_presence:",
    "cooccupant_spatial_extent:",
    "cooccupant_release_timing:",
    "planting_claim_facts",
  ]) {
    assert.ok(requirements.includes(key));
  }

  assert.match(requirements, /Present absence cannot be backdated into a historical clear date without evidence/);
  assert.match(requirements, /registry row was superseded/);
  assert.match(requirements, /expected clear date passed/);
});

test("resolution paths preserve insufficient warrant and do not invent overlap semantics", () => {
  for (const path of [
    "prior_crop_released",
    "lawful_disjoint_sharing",
    "overlapping_or_interplanted",
    "evidence_insufficient_or_conflicting",
  ]) {
    assert.ok(requirements.includes(`'${path}'`));
  }
  assert.match(
    requirements,
    /remain unresolved until an explicit overlap\/interplant relation is represented/,
  );
  assert.match(requirements, /'authorizedChange','none'/);
  assert.match(requirements, /'doesNotAuthorize','forced completeness'/);
});

test("claim repair cannot manufacture missing planting facts", () => {
  assert.match(requirements, /What quantity, unit, and coverage were actually planted/);
  assert.match(
    requirements,
    /unknown quantity or coverage is not invented to complete the registry/,
  );
  assert.match(requirements, /atlas\.record_planting_claim_v1\(\.\.\.\)/);
});

test("Reality Expression v3 composes v2 plus the resolution boundary", () => {
  assert.match(
    requirements,
    /v_base := atlas\.crop_cycle_reality_expression_v2\(p_crop_cycle_id\);/,
  );
  assert.match(
    requirements,
    /v_resolution := atlas\.crop_cycle_relation_resolution_requirements_v1\(p_crop_cycle_id\);/,
  );
  assert.match(requirements, /'contractVersion','crop_cycle_reality_expression_v3'/);
  assert.match(requirements, /'resolutionBoundary'/);
});

test("ordered RPC registry reconciliation freezes both new contracts", () => {
  assert.ok(requirementsMigrationName < registryMigrationName);
  for (const signature of [
    "atlas.crop_cycle_relation_resolution_requirements_v1(uuid)",
    "atlas.crop_cycle_reality_expression_v3(uuid)",
  ]) {
    assert.ok(registry.includes(signature));
  }
  assert.match(registry, /'service_internal','verified','active',false,false,true/);
  assert.match(registry, /Observation is evidence, not automatic adjudication/);
});