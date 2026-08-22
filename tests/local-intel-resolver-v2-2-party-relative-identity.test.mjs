import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationsDirectory = new URL("../supabase/migrations/", import.meta.url);
const readMigration = (name) => readFileSync(new URL(name, migrationsDirectory), "utf8");
const normalize = (sql) => sql.replace(/\s+/g, " ").trim();

const sourceGovernance = readMigration("20260822191546_source_party_relative_governance_v2.sql");
const abacusIdentity = readMigration("20260822191647_abacus_shared_brand_legal_identity_v1.sql");
const resolver = readMigration("20260822191740_entity_resolver_v2_2_party_and_unit_awareness.sql");
const hardening = readMigration("20260822191915_resolver_v2_2_internal_execute_scope_v1.sql");

test("official association directories remain authoritative third-party rather than first-party", () => {
  assert.match(sourceGovernance, /where stable_key='credentialed_directory'/i);
  assert.match(sourceGovernance, /set priority = 35/i);
  assert.match(sourceGovernance, /default_subject_party_relationship[^;]+authoritative_third_party/is);
  assert.match(sourceGovernance, /official publisher status does not make the directory first-party/i);
  assert.match(sourceGovernance, /first_party_only_when_publisher_controls_subject_identity_surface/i);
});

test("source reclassification preserves superseded evidence instead of rewriting history", () => {
  assert.match(sourceGovernance, /create table if not exists local_intel\.source_class_assignment_history/i);
  assert.match(sourceGovernance, /source_class_assignment_history is append-only/i);
  assert.match(sourceGovernance, /before update or delete on local_intel\.source_class_assignment_history/i);
  assert.match(sourceGovernance, /previous_source_class_id/i);
  assert.match(sourceGovernance, /replacement_source_class_id/i);
  assert.match(sourceGovernance, /classifier_version/i);
});

test("Abacus public identity is modeled separately from its named legal entities", () => {
  assert.match(abacusIdentity, /identity_form in \('unknown','public_identity_surface','shared_brand','legal_entity','operating_unit'\)/i);
  assert.match(abacusIdentity, /identity_form='shared_brand'/i);
  assert.match(abacusIdentity, /legal_name=null/i);
  assert.match(abacusIdentity, /'abacus-cpas-llc-legal-entity'/i);
  assert.match(abacusIdentity, /'abacus-business-consulting-llc-legal-entity'/i);
  assert.match(abacusIdentity, /'uses_brand'/i);
  assert.match(abacusIdentity, /'brand_used_by'/i);
  assert.match(abacusIdentity, /'does_not_imply_ownership',true/i);
  assert.match(abacusIdentity, /'does_not_imply_parentage',true/i);
  assert.doesNotMatch(abacusIdentity, /'parent_of'/i);
  assert.doesNotMatch(abacusIdentity, /'subsidiary_of'/i);
});

test("Resolver 2.2 carries party-relative evidence and refuses to assert legal equality", () => {
  assert.match(resolver, /algorithm_version='2\.2'/i);
  assert.match(resolver, /subject_party_relationship/i);
  assert.match(resolver, /publisher_authority/i);
  assert.match(resolver, /'public_identity_surface'::text as identity_match_scope/i);
  assert.match(resolver, /false as same_legal_entity_asserted/i);
  assert.match(resolver, /authoritative_third_party_exact_name_and_website_host/i);
  assert.match(resolver, /identity_form_separation_required/i);
  assert.match(resolver, /legal_identity_collapse_allowed',false/i);
  assert.match(resolver, /automatic_merge_executed',false/i);
});

test("shared brands and legal entities are hard-vetoed from same-entity collapse", () => {
  const normalized = normalize(resolver);
  assert.match(normalized, /lp\.identity_form='shared_brand' and rp\.identity_form='legal_entity'/i);
  assert.match(normalized, /lp\.identity_form='legal_entity' and rp\.identity_form='shared_brand'/i);
  assert.match(normalized, /then 'different_entity'/i);
  assert.match(normalized, /then 'hard_veto_identity_form_separation_required'/i);
});

test("Resolver 2.2 maintenance helpers and internal views are not caller RPCs", () => {
  for (const fn of [
    "refresh_source_class_assignments_v2\\(\\)",
    "block_source_class_assignment_history_mutation_v1\\(\\)",
    "refresh_entity_resolution_v2_2_review_recommendations\\(\\)",
  ]) {
    assert.match(hardening, new RegExp(`revoke all on function local_intel\\.${fn} from public`, "i"));
    assert.match(hardening, new RegExp(`revoke all on function local_intel\\.${fn} from anon`, "i"));
    assert.match(hardening, new RegExp(`revoke all on function local_intel\\.${fn} from authenticated`, "i"));
    assert.match(hardening, new RegExp(`grant execute on function local_intel\\.${fn} to service_role`, "i"));
  }
  assert.match(hardening, /revoke all on table local_intel\.v_entity_ingestion_identity_review_candidates_v2 from public, anon, authenticated/i);
  assert.match(hardening, /revoke all on table local_intel\.v_entity_resolution_resolver_v2_2_live_pair_recommendations from public, anon, authenticated/i);
});