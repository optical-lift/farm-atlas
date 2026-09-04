import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const foundationMigration =
  "supabase/migrations/20260904202000_atlas_core_identity_reconciliation_foundation_v1.sql";
const contractsMigration =
  "supabase/migrations/20260904204000_atlas_core_identity_reconciliation_contracts_v1.sql";

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function tableBlock(sql, tableName) {
  const start = sql.indexOf(`create table if not exists atlas.${tableName} (`);
  assert.notEqual(start, -1, `${tableName} definition must exist`);
  const end = sql.indexOf("\n);", start);
  assert.notEqual(end, -1, `${tableName} definition must terminate`);
  return sql.slice(start, end + 3);
}

test("#788 uses identity subjects rather than a canonical Party directory", () => {
  assert.equal(
    existsSync(join(root, "docs/architecture/atlas-core-party-model-v1.md")),
    false,
  );

  const contract = read("docs/architecture/atlas-core-identity-reconciliation-v1.md");
  assert.match(contract, /identity \*\*evidence-first\*\*/i);
  assert.match(contract, /thin Core subject/i);
  assert.match(contract, /Party, Person, Organization, and Place become projections/i);
  assert.match(contract, /explicit non-match/i);
  assert.match(contract, /split \/ mistaken merge/i);
  assert.doesNotMatch(contract, /Atlas owns canonical Party IDs/i);
});

test("the identity foundation keeps source evidence separate from subjects", () => {
  const sql = read(foundationMigration);
  const subjects = tableBlock(sql, "identity_subjects");

  assert.match(sql, /create table if not exists atlas\.identity_source_records/i);
  assert.match(sql, /create table if not exists atlas\.identity_claims/i);
  assert.match(sql, /create table if not exists atlas\.identity_source_subject_assertions/i);
  assert.match(sql, /create table if not exists atlas\.identity_subject_pair_assertions/i);
  assert.match(sql, /create table if not exists atlas\.identity_reconciliation_adjudications/i);
  assert.match(sql, /create table if not exists atlas\.identity_subject_projections/i);

  assert.doesNotMatch(subjects, /display_name/i);
  assert.doesNotMatch(subjects, /email/i);
  assert.doesNotMatch(subjects, /phone/i);
  assert.doesNotMatch(subjects, /address/i);
  assert.doesNotMatch(subjects, /local_intel/i);
  assert.doesNotMatch(sql, /references\s+local_intel\./i);
});

test("identity evidence and adjudication are append-only while Party stays a projection", () => {
  const sql = read(foundationMigration);

  for (const trigger of [
    "identity_source_records_append_only",
    "identity_claims_append_only",
    "identity_source_subject_assertions_append_only",
    "identity_subject_pair_assertions_append_only",
    "identity_reconciliation_adjudications_append_only",
  ]) {
    assert.match(sql, new RegExp(`create trigger ${trigger}`, "i"));
  }

  assert.match(sql, /create trigger identity_subjects_no_delete/i);
  assert.match(sql, /create or replace view atlas\.v_identity_parties_v1/i);
  assert.match(sql, /from atlas\.identity_subjects s/i);
  assert.match(sql, /left join atlas\.identity_subject_projections p/i);
  assert.match(sql, /Party is a projection, not the underlying ontology/i);
});

test("identity matching preserves ambiguity, non-match, correction, and tenant scope", () => {
  const sql = read(foundationMigration);

  assert.match(sql, /assertion_kind in \('supports','probable','non_match'\)/i);
  assert.match(sql, /assertion_kind in \('equivalent','probably_equivalent','distinct'\)/i);
  assert.match(sql, /'split_correction'/i);
  assert.match(sql, /supersedes_adjudication_id/i);
  assert.match(sql, /to_jsonb\(new\)/i);
  assert.match(sql, /Identity subject is outside organization scope/i);
  assert.match(sql, /Identity subject pair is outside organization scope/i);
  assert.match(sql, /Identity review .* outside organization scope/is);
});

test("authenticated callers can read governed identity evidence but cannot mutate it directly", () => {
  const sql = read(foundationMigration);

  for (const table of [
    "identity_subjects",
    "identity_source_records",
    "identity_claims",
    "identity_source_subject_assertions",
    "identity_subject_pair_assertions",
    "identity_reconciliation_reviews",
    "identity_reconciliation_adjudications",
    "identity_subject_projections",
  ]) {
    assert.match(
      sql,
      new RegExp(`alter table atlas\\.${table} enable row level security`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`, "i"),
    );
    assert.match(
      sql,
      new RegExp(`grant select on table atlas\\.${table} to authenticated`, "i"),
    );
  }

  assert.match(sql, /atlas\.is_organization_member\(organization_id\)/i);
  assert.doesNotMatch(sql, /grant (?:insert|update|delete|all).* to authenticated/i);
});

test("Smart Contacts is provider evidence, not Atlas identity authority", () => {
  const boundary = read("docs/architecture/smart-contacts-elm-local-boundary-v1.md");

  assert.match(boundary, /provider-owned source records/i);
  assert.match(boundary, /identity subjects/i);
  assert.match(boundary, /Similarity is evidence, not proof/i);
  assert.match(boundary, /no new Atlas Core foreign keys target `local_intel`/i);
  assert.doesNotMatch(boundary, /Atlas owns its own party IDs/i);
});

test("Core identity review has a true unresolved outcome rather than treating rejection as uncertainty", () => {
  const sql = read(contractsMigration);

  assert.match(sql, /jsonb_build_array\('same','different','not_enough_evidence'\)/i);
  assert.match(sql, /jsonb_build_array\('split','keep_together','not_enough_evidence'\)/i);
  assert.match(sql, /jsonb_build_array\('accept','reject','not_enough_evidence'\)/i);
  assert.match(sql, /v_decision='not_enough_evidence'/i);
  assert.match(sql, /v_decision_kind := 'defer_unresolved'/i);
  assert.match(sql, /v_resolves_review := false/i);
  assert.match(sql, /reviewState'.*case when v_resolves_review then 'resolved' else 'open'/is);
  assert.match(sql, /'non_match'/i);
  assert.match(sql, /'distinct'/i);
});

test("Core identity review and provenance contracts are Atlas-owned and governed", () => {
  const sql = read(contractsMigration);

  assert.doesNotMatch(sql, /local_intel/i);
  assert.match(sql, /create or replace function atlas\.require_identity_steward_v1/i);
  assert.match(sql, /v_membership\.role not in \('owner','consultant'\)/i);
  assert.match(sql, /create or replace function atlas\.identity_party_projection_v1/i);
  assert.match(sql, /create or replace function atlas\.identity_subject_provenance_v1/i);
  assert.match(sql, /create or replace function atlas\.identity_review_queue_v1/i);
  assert.match(sql, /create or replace function atlas\.identity_adjudicate_review_v1/i);
  assert.match(sql, /canonicalPartyRowCreated',false/i);
  assert.match(sql, /insert into atlas\.authenticated_rpc_registry/i);
  assert.match(sql, /'dependsOnLocalIntel',false/i);
  assert.match(sql, /'notEnoughEvidenceRemainsOpen',true/i);
});
