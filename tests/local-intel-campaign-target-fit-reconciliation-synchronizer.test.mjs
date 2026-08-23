import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260823170849_campaign_target_fit_reconciliation_queue_v1.sql", import.meta.url),
  "utf8",
);

const classifier = migration.match(
  /create or replace view local_intel\.v_campaign_target_fit_reconciliation_queue_v1[\s\S]*?where b\.queue_state is not null;/i,
)?.[0] ?? "";

const researchQueue = migration.match(
  /create or replace view local_intel\.v_campaign_external_space_research_queue_v2[\s\S]*?\) qg on true;/i,
)?.[0] ?? "";

const synchronizer = migration.match(
  /create or replace function local_intel\.sync_campaign_external_space_research_gaps_v2\(p_campaign_id uuid\)[\s\S]*?\nend;\n\$\$;/i,
)?.[0] ?? "";

test("legacy fit contradictions enter reconciliation independent of stale workflow advancement", () => {
  assert.match(classifier, /venue_fit_readiness in \('external_space_fit_supported','external_space_fit_partial_with_self_supply'\)/i);
  assert.match(classifier, /derived_evidence_state in \('no_canonical_external_space_evidence','context_evidence_only'\)/i);
  assert.match(classifier, /then 'legacy_claim_reconciliation'/i);

  const legacyClause = classifier.match(
    /when tev\.venue_fit_readiness in \('external_space_fit_supported','external_space_fit_partial_with_self_supply'\)[\s\S]*?then 'legacy_claim_reconciliation'/i,
  )?.[0] ?? "";
  assert.doesNotMatch(legacyClause, /next_best_enrichment/i);
});

test("ordinary venue-fit research excludes demand-not-yet-proven targets", () => {
  assert.match(classifier, /venue_fit_readiness <> 'demand_not_yet_proven'/i);
  assert.match(classifier, /next_best_enrichment in \('external_space_fit_enrichment','external_space_exception_check'\)/i);
  assert.match(classifier, /then 'research_needed'/i);
});

test("organization queue deduplicates target work into one external-space research job", () => {
  assert.match(researchQueue, /group by t\.campaign_id,t\.organization_entity_id,t\.organization_name/i);
  assert.match(researchQueue, /count\(\*\) as target_count/i);
  assert.match(researchQueue, /count\(\*\) filter \(where t\.queue_state='legacy_claim_reconciliation'\) as contradiction_count/i);
  assert.match(researchQueue, /jsonb_agg\(t\.campaign_target_id/i);
  assert.match(researchQueue, /research_kind='external_space_use_resolution'/i);
  assert.match(researchQueue, /x\.offering_id is null/i);
  assert.match(researchQueue, /x\.use_case_id is null/i);
});

test("synchronizer owns the existing question-gap lifecycle", () => {
  assert.match(synchronizer, /update local_intel\.question_gaps g/i);
  assert.match(synchronizer, /insert into local_intel\.question_gaps/i);
  assert.match(synchronizer, /set status='resolved'/i);
  assert.match(synchronizer, /question_key='external_space_use'/i);
  assert.match(synchronizer, /metadata->>'campaign_id'/i);
  assert.match(synchronizer, /last_synced_by','sync_campaign_external_space_research_gaps_v2'/i);
  assert.match(synchronizer, /created_by','sync_campaign_external_space_research_gaps_v2'/i);
  assert.match(synchronizer, /resolved_by','sync_campaign_external_space_research_gaps_v2'/i);
});

test("contradictions become highest-priority reconciliation gaps without auto-changing fit truth", () => {
  assert.match(synchronizer, /gap_kind=case when q\.contradiction_count>0 then 'external_space_fit_reconciliation'/i);
  assert.match(synchronizer, /priority=case when q\.contradiction_count>0 then 5/i);
  assert.match(synchronizer, /recommended_acquisition=case[\s\S]*?'governed_external_space_research'/i);
  assert.doesNotMatch(synchronizer, /update local_intel\.campaign_targets/i);
  assert.doesNotMatch(synchronizer, /venue_fit_readiness\s*=/i);
});

test("synchronizer refreshes target membership rather than leaving stale per-target gap state", () => {
  assert.match(synchronizer, /'target_ids',q\.target_ids/i);
  assert.match(synchronizer, /'target_contexts',q\.target_contexts/i);
  assert.match(synchronizer, /'contradiction_count',q\.contradiction_count/i);
  assert.match(synchronizer, /'dedupe_scope','organization_once_then_use_case_adjudication'/i);
});

test("synchronizer and internal classifier remain service-only", () => {
  assert.match(migration, /revoke all on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 from public,anon,authenticated/i);
  assert.match(migration, /revoke all on local_intel\.v_campaign_external_space_research_queue_v2 from public,anon,authenticated/i);
  assert.match(migration, /grant select on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 to service_role/i);
  assert.match(migration, /grant select on local_intel\.v_campaign_external_space_research_queue_v2 to service_role/i);
  assert.match(migration, /grant execute on function local_intel\.sync_campaign_external_space_research_gaps_v2\(uuid\) to service_role/i);
});

test("release migration is generic and contains no organization-specific data write", () => {
  for (const organizationName of ["Strafford", "Marshfield R-I", "Rogersville Area Chamber"]) {
    assert.doesNotMatch(migration, new RegExp(organizationName, "i"));
  }
});