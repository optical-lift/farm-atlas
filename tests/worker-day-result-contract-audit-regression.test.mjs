import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function migration(name) {
  return readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8").replace(/\s+/g, " ").trim();
}

const routing = migration("20260822194715_worker_exact_subject_and_followup_routing_v1.sql");
const venue = migration("20260822194924_restore_pot_up_checklist_and_pressure_wash_semantics_v2.sql");
const germinationIdentity = migration("20260822195541_make_germination_identity_crop_cycle_exact_v3.sql");
const resultContract = migration("20260822195620_worker_execution_checklist_result_contract_v1.sql");
const germinationSchedule = migration("20260822195847_sync_germination_rhythm_on_task_reschedule_v1.sql");
const deerReconciliation = migration("20260822221455_reconcile_bb8_deer_thinned_thinning_task_v1.sql");
const venueComponent = readFileSync(new URL("../components/atlas/venue-reset-task-detail.tsx", import.meta.url), "utf8");

test("subject-bearing Worker Day selection requires exact Reality identity", () => {
  assert.ok(routing.includes("subjectBearingRequiresExactRealityIdentity"));
  assert.ok(routing.includes("resolutionRequiredSubjectCount"));
  assert.ok(routing.includes("exact_identity_supported"));
  assert.ok(routing.includes("exactIdentityMismatchCount"));
  assert.ok(routing.includes("presented_work_selection_rows_v1"));
  assert.ok(routing.includes("doesNotCreateClockPlacement"));
  assert.ok(routing.includes("doesNotResolveCropOrProductionReality"));
});

test("germination-driven thinning requires an exact source observation on the same crop cycle", () => {
  assert.ok(routing.includes("source_germination_task_id"));
  assert.ok(routing.includes("spacing_outcome"));
  assert.ok(routing.includes("requiresSameCropCycleOnSourceAndFollowup"));
  assert.ok(routing.includes("requiresCompletedSourceGerminationTask"));
  assert.ok(routing.includes("doesNotInferPhysicalCompletion"));
});

test("serial pot-up identity comes from confirmed owner-defined batch links", () => {
  assert.ok(routing.includes("canonical_batch_task_match"));
  assert.ok(routing.includes("schedule_batch_key"));
  assert.ok(routing.includes("link.role='preserves'"));
  assert.ok(routing.includes("link.source='owner_instruction'"));
  assert.ok(routing.includes("requiresConfirmedPreservesLinks"));
});

test("checklist-backed work advertises its real completion rail and Farm Round stays aggregate-only", () => {
  assert.ok(resultContract.includes("execution_checklist_v1_available"));
  assert.ok(resultContract.includes("'domainAdapter','execution_checklist_v1'"));
  assert.ok(resultContract.includes("aggregate_member_completion_only"));
  assert.ok(resultContract.includes("Farm Round parent completion is derived from terminal member tasks"));
});

test("pressure wash method text is information, not required work", () => {
  assert.ok(venue.includes("v_instruction_only"));
  assert.ok(venue.includes("'interaction',case when v_instruction_only then 'information' else 'action' end"));
  assert.ok(venue.includes("v_index*10,not v_instruction_only,false"));
  assert.match(venueComponent, /item\.interaction === "information"/);
  assert.match(venueComponent, /atlas-reset-row is-information/);
  assert.match(venueComponent, /onClick=\{\(\) => void toggle\(item\)\}/);
});

test("germination dedupe is biological-subject exact instead of variety-and-date only", () => {
  assert.ok(germinationIdentity.includes("germination_task_crop_cycle_id_v1"));
  assert.ok(germinationIdentity.includes("task.metadata->>'object_id'=v_cycle.object_id::text"));
  assert.ok(germinationIdentity.includes("task.metadata->>'source_sowing_task_id'=v_cycle.source_task_id::text"));
  assert.ok(germinationIdentity.includes("automatic_deduplication_allowed',false"));
  assert.ok(germinationIdentity.includes("legacy_identity_unresolved_v2"));
  assert.ok(germinationIdentity.includes("canonical_crop_cycle_carrier"));
});

test("germination task reschedules move the active biological rhythm", () => {
  assert.ok(germinationSchedule.includes("after update of due_date on atlas.tasks"));
  assert.ok(germinationSchedule.includes("old.due_date is distinct from new.due_date"));
  assert.ok(germinationSchedule.includes("perform atlas.enroll_germination_watch_v1(v_cycle_id,new.id)"));
  assert.ok(germinationSchedule.includes("cycle.cycle_state in ('sown','germinating','germination_pending','emerging')"));
});

test("Barn Bed 8 deer thinning is preserved as not relevant rather than fabricated completion", () => {
  assert.ok(deerReconciliation.includes("germination_thinning_365bfba7-e2d6-4a66-b7c8-6cd37f3ccbf1"));
  assert.ok(deerReconciliation.includes("event.outcome='not_relevant'"));
  assert.ok(deerReconciliation.includes("Deer reduced the ProCut Horizon stand in Barn Bed 8 enough that manual thinning is no longer needed."));
  assert.ok(deerReconciliation.includes("refusing to infer it"));
  assert.doesNotMatch(deerReconciliation, /event\.outcome='done'/);
});
