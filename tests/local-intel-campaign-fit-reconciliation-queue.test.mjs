import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260823170849_campaign_target_fit_reconciliation_queue_v1.sql", import.meta.url),
  "utf8",
);

const reconciliationView = migration.match(
  /create or replace view local_intel\.v_campaign_target_fit_reconciliation_queue_v1[\s\S]*?where b\.queue_state is not null;/i,
)?.[0] ?? "";

const researchView = migration.match(
  /create or replace view local_intel\.v_campaign_external_space_research_queue_v2[\s\S]*?else 'execute_external_space_use_research_contract'[\s\S]*?end as next_action[\s\S]*?qg on true;/i,
)?.[0] ?? "";

const sync = migration.match(
  /create or replace function local_intel\.sync_campaign_external_space_research_gaps_v2\(p_campaign_id uuid\)[\s\S]*?end;\n\$\$;/i,
)?.[0] ?? "";

test("reconciliation views use invoker security", () => {
  assert.match(migration, /v_campaign_target_fit_reconciliation_queue_v1\nwith \(security_invoker = true\)/i);
  assert.match(migration, /v_campaign_external_space_research_queue_v2\nwith \(security_invoker = true\)/i);
});

test("legacy strong fit claims cannot escape reconciliation because an old workflow advanced next_best_enrichment", () => {
  assert.match(reconciliationView, /venue_fit_readiness in \('external_space_fit_supported','external_space_fit_partial_with_self_supply'\)/i);
  assert.match(reconciliationView, /derived_evidence_state in \('no_canonical_external_space_evidence','context_evidence_only'\)/i);
  assert.match(reconciliationView, /then 'legacy_claim_reconciliation'/i);
  const legacyClause = reconciliationView.indexOf("then 'legacy_claim_reconciliation'");
  const enrichmentClause = reconciliationView.indexOf("next_best_enrichment in ('external_space_fit_enrichment','external_space_exception_check')");
  assert.ok(legacyClause >= 0 && enrichmentClause > legacyClause, "legacy contradiction detection must precede enrichment routing");
});

test("unproven demand is not pulled forward into ordinary venue-fit research", () => {
  assert.match(reconciliationView, /venue_fit_readiness <> 'demand_not_yet_proven'/i);
  assert.match(reconciliationView, /then 'research_needed'/i);
});

test("governed adjudication provenance is distinguishable from legacy state", () => {
  assert.match(reconciliationView, /campaign_target_fit_adjudications/i);
  assert.match(reconciliationView, /latest_adjudication_id/i);
  assert.match(reconciliationView, /'governed_adjudication'/i);
  assert.match(reconciliationView, /'legacy_or_unadjudicated'/i);
});

test("research queue groups work once per organization and carries contradiction context", () => {
  assert.match(researchView, /where r\.queue_state in \('legacy_claim_reconciliation','research_needed'\)/i);
  assert.match(researchView, /group by t\.campaign_id,t\.organization_entity_id,t\.organization_name/i);
  assert.match(researchView, /count\(\*\) filter \(where t\.queue_state='legacy_claim_reconciliation'\) as contradiction_count/i);
  assert.match(researchView, /'fit_state_provenance',t\.fit_state_provenance/i);
  assert.match(researchView, /'queue_state',t\.queue_state/i);
});

test("recent no-result research prevents mechanical repeat work without treating absence as negative truth", () => {
  assert.match(researchView, /la\.revisit_after is not null and la\.revisit_after > now\(\)/i);
  assert.match(researchView, /'legacy_reconciliation_wait'/i);
  assert.match(researchView, /'recent_unresolved_wait'/i);
  assert.match(researchView, /'human_review_legacy_claim_or_wait_for_new_material_evidence'/i);
});

test("gap sync refreshes existing organization work before inserting new gaps", () => {
  const updateAt = sync.indexOf("update local_intel.question_gaps g");
  const insertAt = sync.indexOf("insert into local_intel.question_gaps");
  assert.ok(updateAt >= 0 && insertAt > updateAt, "existing gaps must be reconciled before missing gaps are inserted");
  assert.match(sync, /'contradiction_count',q\.contradiction_count/i);
  assert.match(sync, /'target_contexts',q\.target_contexts/i);
  assert.match(sync, /'dedupe_scope','organization_once_then_use_case_adjudication'/i);
});

test("gap sync resolves stale research gaps when an organization leaves the queue", () => {
  assert.match(sync, /set status='resolved'/i);
  assert.match(sync, /organization_no_longer_has_external_space_research_or_legacy_reconciliation_targets/i);
  assert.match(sync, /not exists \([\s\S]*v_campaign_external_space_research_queue_v2/i);
});

test("queue synchronization never mutates campaign fit directly", () => {
  assert.doesNotMatch(sync, /update local_intel\.campaign_targets/i);
  assert.doesNotMatch(sync, /adjudicate_campaign_target_fit_v1/i);
});

test("external-space gap lookup has a campaign-scoped open-work index", () => {
  assert.match(migration, /question_gaps_external_space_campaign_open_idx/i);
  assert.match(migration, /on local_intel\.question_gaps\(entity_id,\(\(metadata->>'campaign_id'\)\)\)/i);
  assert.match(migration, /where question_key='external_space_use' and status='open'/i);
});

test("reconciliation reads and gap synchronization remain service-only", () => {
  assert.match(migration, /revoke all on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 from public,anon,authenticated/i);
  assert.match(migration, /revoke all on local_intel\.v_campaign_external_space_research_queue_v2 from public,anon,authenticated/i);
  assert.match(migration, /grant select on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 to service_role/i);
  assert.match(migration, /grant select on local_intel\.v_campaign_external_space_research_queue_v2 to service_role/i);
  assert.match(migration, /grant execute on function local_intel\.sync_campaign_external_space_research_gaps_v2\(uuid\) to service_role/i);
});