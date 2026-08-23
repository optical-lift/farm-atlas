import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260823204816_campaign_target_fit_positive_evidence_adjudication_v2.sql",
    import.meta.url,
  ),
  "utf8",
);

const writer = migration.match(
  /create or replace function local_intel\.adjudicate_campaign_target_fit_v2\(p_payload jsonb\)[\s\S]*?\nend;\n\$\$;/i,
)?.[0] ?? "";

const queue = migration.match(
  /create or replace view local_intel\.v_campaign_target_fit_reconciliation_queue_v1[\s\S]*?where b\.queue_state is not null;/i,
)?.[0] ?? "";

test("positive fit adjudication requires exact use-case external evidence", () => {
  assert.match(writer, /derived_evidence_state='use_case_external_evidence'/i);
  assert.match(writer, /e\.evidence_effect='supports_external_space_fit'/i);
  assert.match(writer, /e\.space_mode in \('external','mixed'\)/i);
  assert.match(writer, /e\.use_case_id=v_target\.offering_use_case_id/i);
  assert.match(writer, /external-space support adjudication requires exact use-case external evidence in the basis/i);
});

test("positive evidence yields only the governed use-case support state", () => {
  assert.match(writer, /v_new_fit := 'external_space_fit_supported'/i);
  assert.match(writer, /v_new_next := 'marketing_eligibility_review'/i);
  assert.match(writer, /does not imply that every gathering uses external space or that another use case shares the same fit/i);
});

test("organization-level unresolved evidence cannot establish use-case fit", () => {
  assert.match(
    writer,
    /derived_evidence_state in \('context_evidence_only','no_canonical_external_space_evidence','organization_external_evidence_use_case_unresolved'\)/i,
  );
  assert.match(writer, /does not support a target-fit change or confirmation/i);
});

test("already-correct legacy state receives provenance without a fake target mutation", () => {
  assert.match(writer, /v_requires_target_update boolean := false/i);
  assert.match(
    writer,
    /v_requires_target_update := v_target\.venue_fit_readiness is distinct from v_new_fit[\s\S]*?v_target\.next_best_enrichment is distinct from v_new_next/i,
  );
  assert.match(writer, /'state_change_required',v_requires_target_update/i);
  assert.match(writer, /if v_requires_target_update then[\s\S]*?update local_intel\.campaign_targets/i);
  assert.doesNotMatch(writer, /already has the adjudicated fit state/i);
});

test("v2 preserves the internal self-supply policy and its non-negative semantics", () => {
  assert.match(writer, /derived_evidence_state='internal_self_supply_evidence_only'/i);
  assert.match(writer, /e\.evidence_effect='supports_internal_self_supply'/i);
  assert.match(writer, /v_new_fit := 'external_space_fit_needs_exception_evidence'/i);
  assert.match(writer, /v_new_next := 'external_space_exception_check'/i);
  assert.match(writer, /does not prove that external space is never used/i);
});

test("adjudication history remains immutable evidence-backed policy provenance", () => {
  assert.match(writer, /basis_evidence_ids must be a subset of the target current evidence projection/i);
  assert.match(writer, /basis evidence must belong to the target organization and exact use-case scope or organization-wide scope/i);
  assert.match(writer, /basis_evidence_snapshot/i);
  assert.match(writer, /'deterministic_evidence_policy','external_space_fit_adjudication',2/i);
  assert.match(writer, /'system:external_space_fit_adjudication_v2'/i);
});

test("reconciliation makes positive evidence adjudication-ready and recognizes governed confirmation", () => {
  assert.match(queue, /derived_evidence_state = 'use_case_external_evidence'/i);
  assert.match(queue, /a\.derived_evidence_state = 'use_case_external_evidence'/i);
  assert.match(queue, /then 'adjudication_ready_external_space'/i);
  assert.match(queue, /adjudicate_target_fit_from_exact_external_use_evidence_v2/i);
});

test("legacy contradictions remain ahead of stale workflow advancement", () => {
  const legacy = queue.indexOf("then 'legacy_claim_reconciliation'");
  const research = queue.indexOf("then 'research_needed'");
  assert.ok(legacy >= 0 && research >= 0 && legacy < research);
  assert.match(queue, /external_space_fit_supported','external_space_fit_partial_with_self_supply/i);
  assert.match(queue, /no_canonical_external_space_evidence','context_evidence_only/i);
});

test("demand-not-yet-proven remains outside ordinary venue-fit research", () => {
  assert.match(queue, /venue_fit_readiness <> 'demand_not_yet_proven'/i);
});

test("v2 writer and reconciliation projection are service-only", () => {
  assert.match(
    migration,
    /revoke all on function local_intel\.adjudicate_campaign_target_fit_v2\(jsonb\) from public,anon,authenticated,service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function local_intel\.adjudicate_campaign_target_fit_v2\(jsonb\) to service_role/i,
  );
  assert.match(migration, /with \(security_invoker = true\)/i);
  assert.match(
    migration,
    /revoke all on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 from public,anon,authenticated/i,
  );
  assert.match(
    migration,
    /grant select on local_intel\.v_campaign_target_fit_reconciliation_queue_v1 to service_role/i,
  );
});

test("release migration is generic and contains no organization-specific fixture", () => {
  for (const forbidden of [
    "Marshfield Area Chamber",
    "Rogersville Area Chamber",
    "2effc77b-c117-434c-90d9-df651707d05e",
    "e4914105-ed1a-47e6-a7cb-032005049905",
  ]) {
    assert.doesNotMatch(migration, new RegExp(forbidden, "i"));
  }
});
