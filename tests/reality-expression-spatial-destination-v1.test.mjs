import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const foundation = readFileSync(
  "supabase/migrations/20260818041704_crop_spatial_destination_claims_v1.sql",
  "utf8",
);
const coverage = readFileSync(
  "supabase/migrations/20260818041836_crop_destination_claim_coverage_and_resolution_v1.sql",
  "utf8",
);
const subjectLinks = readFileSync(
  "supabase/migrations/20260818042001_link_transplant_task_crop_cycle_subjects_v1.sql",
  "utf8",
);
const mainGardenBackfill = readFileSync(
  "supabase/migrations/20260818042014_backfill_owner_committed_main_garden_crop_destination_claims_v1.sql",
  "utf8",
);
const placementFix = readFileSync(
  "supabase/migrations/20260818042202_separate_current_placement_from_future_destination_v1.sql",
  "utf8",
);
const occurrenceContinuity = readFileSync(
  "supabase/migrations/20260818042416_spatial_destination_occurrence_continuity_and_unique_actuals_v1.sql",
  "utf8",
);
const waitState = readFileSync(
  "supabase/migrations/20260818042636_spatial_destination_wait_state_and_occurrence_relations_v1.sql",
  "utf8",
);
const auditV4 = readFileSync(
  "supabase/migrations/20260818042718_farm_continuity_audit_spatial_destination_v4.sql",
  "utf8",
);
const registry = readFileSync(
  "supabase/migrations/20260818042828_spatial_destination_rpc_registry_v1.sql",
  "utf8",
);
const fkIndexes = readFileSync(
  "supabase/migrations/20260818043154_crop_destination_claim_fk_indexes_v1.sql",
  "utf8",
);

test("Phase 10 adds a crop-domain pre-placement claim rail without reusing occupancy", () => {
  assert.match(foundation, /create table if not exists atlas\.crop_destination_claims/i);
  for (const token of [
    "claim_source",
    "crop_cycle_id",
    "destination_object_id",
    "claimed_quantity",
    "required_by",
    "claim_strength",
    "displacement_authority",
    "protection_reason",
    "source_evidence",
  ]) {
    assert.match(foundation, new RegExp(token, "i"));
  }
  assert.match(foundation, /alter table atlas\.crop_destination_claims enable row level security/i);
  assert.match(foundation, /revoke all on atlas\.crop_destination_claims from public,anon,authenticated/i);
  assert.match(foundation, /grant select,insert,update,delete on atlas\.crop_destination_claims to service_role/i);
  assert.doesNotMatch(foundation, /alter table atlas\.crop_placements/i);
});

test("known moving cohorts require quantitative destination coverage", () => {
  assert.match(coverage, /create or replace function atlas\.crop_destination_claim_coverage_v1/i);
  for (const source of [
    "transplant_ready_seedlings",
    "owner_assumed_transplant_count",
    "last_seedling_count",
    "allocated_seedlings",
    "crop_cycle_coverage",
  ]) {
    assert.match(coverage, new RegExp(source, "i"));
  }
  assert.match(coverage, /v_claimed\+0\.0001 < v_required/i);
  assert.match(coverage, /v_state:='partial'; v_release:=false/i);
  assert.match(coverage, /v_state:='complete'; v_release:=true/i);
  assert.match(coverage, /known moving cohort quantity is known|moving cohort quantity is known/i);
});

test("metadata subject references are repaired into canonical transplant relations without hard-coded subjects", () => {
  assert.match(subjectLinks, /task_metadata_crop_cycle_ids/i);
  assert.match(subjectLinks, /task_metadata_source_crop_cycle_id/i);
  assert.match(subjectLinks, /task_crop_cycles/i);
  assert.match(subjectLinks, /t\.task_type in \('transplanting','production_transplant'\)/i);
  assert.doesNotMatch(subjectLinks, /values\s*\(\s*'[0-9a-f-]{36}'::uuid/i);
});

test("Owner-committed Main Garden claims are evidence-scoped rather than ID-scoped", () => {
  assert.match(mainGardenBackfill, /owner_instruction_20260814/i);
  assert.match(mainGardenBackfill, /atlas_audit_20260814/i);
  assert.match(mainGardenBackfill, /destination_zone'='Main Garden/i);
  assert.match(mainGardenBackfill, /plants_per_destination/i);
  assert.match(mainGardenBackfill, /claim_strength/i);
  assert.match(mainGardenBackfill, /'committed'/i);
  assert.match(mainGardenBackfill, /'management'/i);
  assert.doesNotMatch(mainGardenBackfill, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
});

test("current placement is explicitly not future destination warrant", () => {
  assert.match(placementFix, /current_source_placement/i);
  assert.match(placementFix, /currentPlacementIsNotFutureDestination/i);
  assert.match(placementFix, /Current placement describes present custody\/location and never establishes a future destination/i);
  assert.doesNotMatch(placementFix, /if v_placement_count>0 then v_state:='placed'; v_destination_warrant:=true/i);
});

test("resolution work may live as a planned occurrence without becoming execution release", () => {
  assert.match(occurrenceContinuity, /atlas\.planned_work_occurrences/i);
  assert.match(occurrenceContinuity, /source_kind='crop_cycle_destination'/i);
  assert.match(occurrenceContinuity, /source_kind='task_destination_resolution'/i);
  assert.match(occurrenceContinuity, /plannedOccurrenceIsLawfulContinuationNotRelease/i);
  assert.match(occurrenceContinuity, /plannedOccurrenceCountsAsResolutionPath/i);
  assert.match(occurrenceContinuity, /resolutionPathDoesNotEqualReady/i);
});

test("completed transplant cards are de-duplicated and never treated as physical empty-source proof", () => {
  assert.match(occurrenceContinuity, /with unique_done_tasks as/i);
  assert.match(occurrenceContinuity, /select distinct t\.id,t\.metadata/i);
  assert.match(occurrenceContinuity, /task completion alone does not prove the source body is empty/i);
  assert.match(occurrenceContinuity, /spatial_destination_reconciliation/i);
});

test("spatial warrant remains distinct from weather, timing, biology, resource, and capacity release", () => {
  assert.match(waitState, /waiting_weather_release/i);
  assert.match(waitState, /waiting_required_by_window/i);
  assert.match(waitState, /destination_claimed_other_gates_remain/i);
  assert.match(waitState, /spatialWarrantIsNotFullExecutionRelease/i);
  assert.match(waitState, /'executionReleaseAllowed',false/i);
  assert.match(waitState, /timing, weather, biological, resource, or human-capacity gates/i);
});

test("Production transplant keeps its native gate while Crop uses destination claims", () => {
  assert.match(occurrenceContinuity, /v_type='production_transplant'/i);
  assert.match(occurrenceContinuity, /atlas\.production_transplant_gates/i);
  assert.match(occurrenceContinuity, /v_gate\.gate_status='ready'/i);
  assert.match(occurrenceContinuity, /productionTransplantUsesNativeGate/i);
  assert.match(occurrenceContinuity, /atlas\.crop_destination_claim_coverage_v1/i);
});

test("Continuity Audit v4 separates governed continuation from silent breach without hiding unrelated families", () => {
  assert.match(auditV4, /farm_continuity_audit_v4/i);
  assert.match(auditV4, /farm_continuity_audit_v3/i);
  assert.match(auditV4, /spatial_destination_governed_continuation/i);
  assert.match(auditV4, /hardening_off_uncovered/i);
  assert.match(auditV4, /transplant_destination_unresolved/i);
  assert.match(auditV4, /no_lawful_next_state/i);
  assert.match(auditV4, /where f->>'key' not in \('hardening_off_uncovered','transplant_destination_unresolved','no_lawful_next_state'\)/i);
  assert.match(auditV4, /principalEscalationCreated',false/i);
  assert.doesNotMatch(auditV4, /missing_destination'\s*\)/i);
});

test("Phase 10 service boundaries and provenance FKs are explicit", () => {
  for (const signature of [
    "crop_spatial_destination_reality_expression_v1",
    "crop_destination_claim_coverage_v1",
    "record_crop_destination_claim_v1",
    "ensure_crop_destination_resolution_v1",
    "ensure_task_destination_resolution_v1",
  ]) {
    assert.match(registry, new RegExp(`atlas\\.${signature}`, "i"));
  }
  assert.match(registry, /'service_internal','verified','active',false,false,true/i);
  assert.match(registry, /farm_continuity_audit_v4\(uuid, date\)/i);
  assert.match(registry, /'app_endpoint','verified','active',true,true,true/i);
  assert.match(fkIndexes, /crop_destination_claims_source_task_idx/i);
  assert.match(fkIndexes, /crop_destination_claims_recorder_idx/i);
});
