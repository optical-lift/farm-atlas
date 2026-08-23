import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const membrane = readFileSync(
  new URL("../supabase/migrations/20260823030421_campaign_target_fit_adjudication_membrane_v1.sql", import.meta.url),
  "utf8",
);

const indexes = readFileSync(
  new URL("../supabase/migrations/20260823132540_campaign_target_fit_adjudication_fk_indexes_v1.sql", import.meta.url),
  "utf8",
);

const writer = membrane.match(
  /create or replace function local_intel\.adjudicate_campaign_target_fit_v1\(p_payload jsonb\)[\s\S]*?\nend;\n\$\$;/i,
)?.[0] ?? "";

const guard = membrane.match(
  /create or replace function local_intel\.enforce_campaign_target_fit_adjudication_v1\(\)[\s\S]*?\nend;\n\$\$;/i,
)?.[0] ?? "";

test("target-fit adjudications are immutable governed history", () => {
  assert.match(membrane, /create table if not exists local_intel\.campaign_target_fit_adjudications/i);
  assert.match(membrane, /adjudication_key text not null unique/i);
  assert.match(membrane, /block_campaign_target_fit_adjudication_mutation_v1/i);
  assert.match(membrane, /before update or delete on local_intel\.campaign_target_fit_adjudications/i);
  assert.match(membrane, /campaign target fit adjudications are append-only/i);
});

test("direct venue-fit changes require a matching adjudication in the same transaction", () => {
  assert.match(membrane, /before update of venue_fit_readiness on local_intel\.campaign_targets/i);
  assert.match(guard, /a\.write_txid = txid_current\(\)/i);
  assert.match(guard, /a\.campaign_target_id = old\.id/i);
  assert.match(guard, /previous_venue_fit_readiness/i);
  assert.match(guard, /new_venue_fit_readiness/i);
  assert.match(guard, /venue_fit_readiness may change only through governed target-fit adjudication/i);
});

test("writer derives fit from the current governed external-space evidence projection", () => {
  assert.match(writer, /v_campaign_external_space_target_evidence_v1/i);
  assert.match(writer, /basis_evidence_ids must be a subset of the target current evidence projection/i);
  assert.match(writer, /basis evidence must belong to the target organization and exact use-case scope or organization-wide scope/i);
  assert.match(writer, /basis_evidence_snapshot/i);
});

test("deterministic policy writes only the internal self-supply evidence state", () => {
  assert.match(writer, /derived_evidence_state='internal_self_supply_evidence_only'/i);
  assert.match(writer, /evidence_effect='supports_internal_self_supply'/i);
  assert.match(writer, /v_new_fit := 'external_space_fit_needs_exception_evidence'/i);
  assert.match(writer, /v_new_next := 'external_space_exception_check'/i);
  for (const blockedState of [
    "context_evidence_only",
    "no_canonical_external_space_evidence",
    "organization_external_evidence_use_case_unresolved",
  ]) {
    assert.ok(writer.includes(`'${blockedState}'`));
  }
  assert.match(writer, /does not support a target-fit change; continue research or adjudicate use-case scope/i);
});

test("writer is idempotent by adjudication key but cannot repoint immutable history", () => {
  assert.match(writer, /where adjudication_key=v_key/i);
  assert.match(writer, /already belongs to different immutable adjudication/i);
  assert.match(writer, /return v_existing\.id/i);
});

test("only the governed writer can write and service role can only read the history table", () => {
  assert.match(membrane, /revoke all on local_intel\.campaign_target_fit_adjudications from public, anon, authenticated, service_role/i);
  assert.match(membrane, /grant select on local_intel\.campaign_target_fit_adjudications to service_role/i);
  assert.match(membrane, /grant execute on function local_intel\.adjudicate_campaign_target_fit_v1\(jsonb\) to service_role/i);
  assert.match(membrane, /revoke all on function local_intel\.block_campaign_target_fit_adjudication_mutation_v1\(\) from public, anon, authenticated, service_role/i);
  assert.match(membrane, /revoke all on function local_intel\.enforce_campaign_target_fit_adjudication_v1\(\) from public, anon, authenticated, service_role/i);
});

test("adjudication history has indexes for every non-primary foreign-key lookup", () => {
  assert.match(indexes, /campaign_target_fit_adjudications_campaign_idx[\s\S]*?\(campaign_id\)/i);
  assert.match(indexes, /campaign_target_fit_adjudications_offering_use_case_idx[\s\S]*?\(offering_use_case_id\)/i);
  assert.match(indexes, /campaign_target_fit_adjudications_organization_idx[\s\S]*?\(organization_entity_id\)/i);
  assert.match(membrane, /campaign_target_fit_adjudications_target_idx[\s\S]*?\(campaign_target_id, adjudicated_at desc\)/i);
});

test("release migration remains generic and contains no Strafford data write", () => {
  assert.doesNotMatch(membrane, /Strafford/i);
  assert.doesNotMatch(indexes, /Strafford/i);
});