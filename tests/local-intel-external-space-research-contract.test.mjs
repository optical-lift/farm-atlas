import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260823021914_external_space_research_contract_v1.sql", import.meta.url),
  "utf8",
);
const familyBridge = readFileSync(
  new URL("../supabase/migrations/20260823021948_external_space_question_family_bridge_v1.sql", import.meta.url),
  "utf8",
);
const pilotSeed = readFileSync(
  new URL("../supabase/migrations/20260823022113_seed_elm_venue_external_space_research_gaps_v1.sql", import.meta.url),
  "utf8",
);

const writer = migration.match(
  /create or replace function local_intel\.record_organization_external_space_evidence_v1\(p_payload jsonb\)[\s\S]*?\nend;\n\$function\$;/i,
)?.[0] ?? "";
const queue = migration.match(
  /create or replace view local_intel\.v_campaign_external_space_research_queue_v1 as[\s\S]*?;\n\ncreate or replace function local_intel\.sync_campaign_external_space_research_gaps_v1/i,
)?.[0] ?? "";

test("external-space use is a reusable governed research question", () => {
  assert.match(migration, /'external_space_use',1,'active'/i);
  assert.match(migration, /'external_space_use_resolution','entity'/i);
  assert.match(migration, /'truth_layer','organization_external_space_evidence'/i);
  assert.match(migration, /'evidence_is_not_fit_adjudication',true/i);
  assert.match(migration, /'no_evidence_found_is_not_negative_proof',true/i);
});

test("external-space use is registered in both research and question-gap registries", () => {
  assert.match(familyBridge, /'external_space_use'/i);
  assert.match(familyBridge, /array\['entity','outreach_target'\]::text\[\]/i);
  assert.match(familyBridge, /organization-level evidence does not automatically establish every use-case fit/i);
  assert.match(familyBridge, /no search result is not evidence that external space is never used/i);
});

test("source waterfall prefers attributable operational evidence and preserves negative uncertainty", () => {
  for (const sourceClass of [
    "first_party_official",
    "direct_provider",
    "primary_authority",
    "transaction_platform",
    "reputable_secondary",
    "public_social",
    "current_directory",
    "discovery_only",
  ]) {
    assert.match(migration, new RegExp(`'${sourceClass}'`, "i"));
  }
  assert.match(migration, /absence of external-space evidence is never converted into a claim that external space is not used/i);
  assert.match(migration, /never_infer_no_external_use_from_no_search_result/i);
  assert.match(migration, /never_infer_use_case_fit_from_organization_level_venue_use_alone/i);
});

test("canonical external-space evidence is structured and append-only", () => {
  assert.match(migration, /create table if not exists local_intel\.organization_external_space_evidence/i);
  assert.match(migration, /space_mode in \('external','internal','mixed','unknown'\)/i);
  assert.match(migration, /evidence_kind in \('observed_event_location','venue_booking_or_rental','venue_search_or_rfp','facility_inventory','explicit_space_preference','other'\)/i);
  assert.match(migration, /evidence_effect in \('supports_external_space_fit','supports_internal_self_supply','mixed_or_ambiguous','context_only'\)/i);
  assert.match(migration, /organization_external_space_evidence_append_only_v1/i);
  assert.match(migration, /append-only; append new evidence instead/i);
});

test("evidence writer requires a source admissible for the exact research question", () => {
  assert.match(writer, /v_research_source_question_admissibility_v1/i);
  assert.match(writer, /research_question_key='external_space_use'/i);
  assert.match(writer, /currently_admissible/i);
  assert.match(writer, /source % is not currently admissible for external_space_use research/i);
});

test("evidence identity is idempotent but immutable", () => {
  assert.match(writer, /where evidence_key=v_evidence_key/i);
  assert.match(writer, /already belongs to different immutable evidence/i);
  assert.match(writer, /return v_existing\.id/i);
});

test("target evidence distinguishes organization behavior from use-case evidence", () => {
  assert.match(migration, /same_use_case_external_count/i);
  assert.match(migration, /organization_external_count/i);
  assert.match(migration, /same_use_case_internal_count/i);
  assert.match(migration, /organization_internal_count/i);
  assert.match(migration, /use_case_external_evidence/i);
  assert.match(migration, /organization_external_evidence_use_case_unresolved/i);
  assert.match(migration, /internal_self_supply_evidence_only/i);
  assert.match(migration, /adjudicate_use_case_scope/i);
});

test("research queue deduplicates by organization while preserving all target contexts", () => {
  assert.match(queue, /group by campaign_id,organization_entity_id,organization_name/i);
  assert.match(queue, /count\(\*\) target_count/i);
  assert.match(queue, /jsonb_agg\(campaign_target_id order by rank_score desc\) target_ids/i);
  assert.match(queue, /target_contexts/i);
  assert.match(queue, /'external_space_fit_enrichment','external_space_exception_check'/i);
});

test("evidence presence routes to adjudication instead of silently rewriting campaign target fit", () => {
  assert.match(queue, /evidence_present_needs_target_adjudication/i);
  assert.match(queue, /adjudicate_target_use_case_fit_from_canonical_evidence/i);
  assert.doesNotMatch(migration, /update\s+local_intel\.campaign_targets\s+set\s+venue_fit_readiness/i);
});

test("research gaps are synchronized once per campaign organization", () => {
  assert.match(migration, /sync_campaign_external_space_research_gaps_v1/i);
  assert.match(migration, /q\.question_gap_id is null/i);
  assert.match(migration, /'dedupe_scope','organization_once_then_use_case_adjudication'/i);
  assert.match(migration, /'governed_external_space_research'/i);
});

test("pilot seed resolves the campaign by durable name instead of generated UUID", () => {
  assert.match(pilotSeed, /where name='Elm Venue Pilot 01 — Market Learning'/i);
  assert.match(pilotSeed, /sync_campaign_external_space_research_gaps_v1\(v_campaign_id\)/i);
  assert.doesNotMatch(pilotSeed, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("external-space writes stay behind service-only functions", () => {
  assert.match(migration, /revoke all on local_intel\.organization_external_space_evidence from public,anon,authenticated,service_role/i);
  assert.match(migration, /grant select on local_intel\.organization_external_space_evidence to service_role/i);
  assert.match(migration, /revoke execute on function local_intel\.record_organization_external_space_evidence_v1\(jsonb\) from public,anon,authenticated/i);
  assert.match(migration, /grant execute on function local_intel\.record_organization_external_space_evidence_v1\(jsonb\) to service_role/i);
  assert.match(migration, /revoke execute on function local_intel\.block_organization_external_space_evidence_mutation_v1\(\) from public,anon,authenticated,service_role/i);
});