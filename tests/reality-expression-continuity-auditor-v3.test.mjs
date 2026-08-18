import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const runtimeIndexes = readFileSync(
  "supabase/migrations/20260818023946_continuity_auditor_runtime_indexes_v1.sql",
  "utf8",
);
const setBasedCoverage = readFileSync(
  "supabase/migrations/20260818024227_continuity_auditor_set_based_coverage_v1.sql",
  "utf8",
);
const auditorV3 = readFileSync(
  "supabase/migrations/20260818024618_reality_expression_continuity_auditor_v3.sql",
  "utf8",
);
const collisionWarrantFix = readFileSync(
  "supabase/migrations/20260818024754_continuity_auditor_destination_collision_warrant_fix_v1.sql",
  "utf8",
);

test("continuity coverage has indexes for canonical and legacy relation paths", () => {
  for (const token of [
    "planned_work_occurrences_farm_state_source_idx",
    "planned_work_occurrences_farm_state_released_task_idx",
    "tasks_farm_metadata_crop_cycle_id_idx",
    "tasks_metadata_crop_cycle_ids_gin_idx",
  ]) {
    assert.match(runtimeIndexes, new RegExp(token, "i"));
  }
});

test("legacy v1 continuity coverage is rewritten as one set-based relation map", () => {
  for (const token of [
    "active_cycles as materialized",
    "farm_tasks as materialized",
    "task_cycle_links as materialized",
    "current_cycles as",
    "future_cycles as",
    "left join current_cycles",
    "left join future_cycles",
  ]) {
    assert.match(setBasedCoverage, new RegExp(token, "i"));
  }
  assert.match(setBasedCoverage, /task_crop_cycles/i);
  assert.match(setBasedCoverage, /metadata->>'crop_cycle_id'/i);
  assert.match(setBasedCoverage, /metadata->'crop_cycle_ids'/i);
  assert.match(setBasedCoverage, /p\.pronamespace/i);
  assert.doesNotMatch(setBasedCoverage, /p\.relnamespace/i);
});

test("continuity auditor v3 exposes every Reality Expression Phase 7 failure family", () => {
  for (const family of [
    "no_lawful_next_state",
    "missing_destination",
    "overclaimed_availability",
    "destination_collision",
    "committed_work_without_labor_capacity",
    "result_without_continuation",
    "orphaned_expected_next_stage",
  ]) {
    assert.match(auditorV3, new RegExp(`'${family}'`, "i"));
  }
});

test("no-lawful-next-state comes from canonical silent continuity rather than missing tasks alone", () => {
  assert.match(auditorV3, /continuity,silentNothing/i);
  assert.match(auditorV3, /living_subject_without_known_continuation/i);
  assert.match(auditorV3, /crop_cycle_reality_expression_v4/i);
});

test("availability overallocation requires trusted canonical conflict evidence", () => {
  assert.match(auditorV3, /established_overallocation/i);
  assert.match(auditorV3, /conflictEstablished/i);
  assert.match(
    auditorV3,
    /sharedClaimsWithoutTrustedPhysicalWarrantAreNotOverclaimed/i,
  );
});

test("missing destination remains distinct from an orphaned future stage", () => {
  assert.match(
    auditorV3,
    /flowBufferClaim,claims,destination,state/i,
  );
  assert.match(auditorV3, /resolve_readiness/i);
  assert.match(auditorV3, /next_expected_date/i);
  assert.match(auditorV3, /inspect_continuity/i);
});

test("committed labor capacity means a real Worker Day claim, not an estimate", () => {
  assert.match(auditorV3, /worker_day_task_placements/i);
  assert.match(auditorV3, /p\.state='placed'/i);
  assert.match(auditorV3, /worker_week_day_capacity_v1/i);
  assert.match(auditorV3, /maximumUsableMinutes/i);
  assert.match(auditorV3, /laborEstimateIsNotLaborClaim/i);
});

test("result-without-continuation follows structured fruit back to the current crop subject", () => {
  assert.match(auditorV3, /production_operation_actual_crop_cycles/i);
  assert.match(auditorV3, /production_operation_actuals/i);
  assert.match(auditorV3, /crop_cycle_reality_expression_v4/i);
  assert.match(auditorV3, /taskCompletionIsNotContinuationProof/i);
});

test("destination collision patch requires incompatibility evidence beyond overlap", () => {
  assert.match(collisionWarrantFix, /exclusive_claim/i);
  assert.match(collisionWarrantFix, /coverage_kind in \('whole_object','full_bed'\)/i);
  assert.match(collisionWarrantFix, /coverage_fraction,1\)\+coalesce\(cb\.coverage_fraction,1\)>1/i);
  assert.match(
    collisionWarrantFix,
    /explicit_rectangle_overlap_against_exclusive_claim/i,
  );
  assert.match(
    collisionWarrantFix,
    /canonical exclusivity or capacity evidence establishes incompatibility/i,
  );
});

test("continuity audit never creates Principal work by itself", () => {
  assert.match(auditorV3, /principalEscalationCreated',false/i);
  assert.match(auditorV3, /auditDoesNotCreatePrincipalWork/i);
  assert.match(
    auditorV3,
    /until an explicit escalation threshold translates them into an ownership decision/i,
  );
});
