import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const candidate = readFileSync(
  "supabase/migrations/20260818145118_farm_clock_reality_candidate_v1.sql",
  "utf8",
);
const selector = readFileSync(
  "supabase/migrations/20260818145228_farm_clock_reality_selection_v2.sql",
  "utf8",
);
const greedy = readFileSync(
  "supabase/migrations/20260818145345_farm_clock_reality_selection_greedy_capacity_fix_v2.sql",
  "utf8",
);
const adoption = readFileSync(
  "supabase/migrations/20260818150422_farm_clock_reality_canonical_adoption_v1.sql",
  "utf8",
);
const workerDay = readFileSync(
  "supabase/migrations/20260818150730_worker_day_farm_clock_reality_evidence_v1.sql",
  "utf8",
);

test("Phase 12 builds a lightweight reality warrant instead of running deep Reality Expression per Clock row", () => {
  assert.match(candidate, /farm_clock_reality_candidates_v1/i);
  assert.match(candidate, /atlas\.task_crop_cycles/i);
  assert.match(candidate, /atlas\.crop_cycles/i);
  assert.match(candidate, /atlas\.production_lot_tasks/i);
  assert.match(candidate, /atlas\.production_lots/i);
  assert.match(candidate, /atlas\.rhythm_state/i);
  assert.match(candidate, /atlas\.planned_work_occurrences/i);
  assert.doesNotMatch(candidate, /task_reality_subject_snapshot_v1/i);
  assert.match(candidate, /fullRealityPacketIsExplanationNotClockHotPath',true/i);
});

test("reality warrant strength is explicit and canonical subjects outrank task-only carriers", () => {
  assert.match(candidate, /canonical_domain_subject/i);
  assert.match(candidate, /canonical_rhythm_subject/i);
  assert.match(candidate, /source_linked_occurrence/i);
  assert.match(candidate, /explicit_hard_commitment/i);
  assert.match(candidate, /occurrence_carrier/i);
  assert.match(candidate, /task_carrier_only/i);
  assert.match(candidate, /crop\.subject_count,0\)\+coalesce\(prod\.subject_count,0\)>0 then 0/i);
  assert.match(candidate, /rhythm\.subject_count,0\)>0 then 1/i);
  assert.match(candidate, /occurrence\.id is not null then 4/i);
  assert.match(candidate, /else 9/i);
});

test("reality warrant cannot bypass readiness, destination, time, claims, or capacity", () => {
  assert.match(candidate, /realityWarrantDoesNotBypassReadiness',true/i);
  assert.match(candidate, /realityWarrantDoesNotBypassDestination',true/i);
  assert.match(candidate, /realityWarrantDoesNotBypassTemporalWindow',true/i);
  assert.match(candidate, /realityWarrantDoesNotBypassClaimOrCapacityFit',true/i);
  assert.match(candidate, /taskRemainsExecutionCarrier',true/i);
  assert.match(candidate, /task_worker_day_deferral_v1/i);
  assert.match(candidate, /task_temporally_eligible_v1/i);
});

test("flexible capacity order is consequence then reality warrant before stored task priority", () => {
  const order = greedy.match(/order by coalesce\(c\.consequence_tier,99\),c\.reality_warrant_order,c\.due_date nulls last,[\s\S]*?case c\.priority when 'urgent'/i);
  assert.ok(order, "greedy selector must rank consequence then reality warrant before stored priority");
  assert.match(candidate, /storedPriorityRanksAfterRealityWarrantAmongOtherwiseEquivalentFlexibleWork',true/i);
});

test("required and protected work are removed before flexible Reality arbitration", () => {
  assert.match(greedy, /protected_minimum_selected/i);
  assert.match(greedy, /consequence_required_selected/i);
  assert.match(greedy, /hard_date_selected/i);
  assert.match(greedy, /required_over_capacity/i);
  assert.match(greedy, /required_selected/i);
  assert.match(greedy, /v_paid_target-v_required_minutes/i);
  assert.match(greedy, /v_heavy_cap-v_required_heavy_minutes/i);
});

test("Phase 11 weekly normal and heavy claims bound optional Farm Clock capacity", () => {
  assert.match(selector, /worker_weekly_labor_claims_v2/i);
  assert.match(selector, /remainingOptionalPlannedAvailabilityMinutes/i);
  assert.match(selector, /remainingOptionalHeavyAvailabilityMinutes/i);
  assert.match(greedy, /worker_weekly_labor_claims_v2/i);
  assert.match(greedy, /remainingOptionalPlannedAvailabilityMinutes/i);
  assert.match(greedy, /remainingOptionalHeavyAvailabilityMinutes/i);
  assert.match(greedy, /least\(greatest\(v_paid_target-v_required_minutes,0\),v_week_optional_room\)/i);
  assert.match(greedy, /least\(greatest\(v_heavy_cap-v_required_heavy_minutes,0\),v_week_optional_heavy_room\)/i);
});

test("rejected flexible candidates consume no labor or heavy-load capacity", () => {
  assert.match(greedy, /if v_used_minutes\+v_item\.expected_active_minutes<=v_flexible_room/i);
  assert.match(greedy, /v_item_state:='presented'/i);
  assert.match(greedy, /v_used_minutes:=v_used_minutes\+v_item\.expected_active_minutes/i);
  assert.match(greedy, /if v_item\.physical_load='heavy' then[\s\S]*v_used_heavy_minutes:=v_used_heavy_minutes\+v_item\.expected_active_minutes/i);
  const elseBranch = greedy.match(/else\s+v_item_state:='held';[\s\S]*?end if;\s+v_decisions:=/i)?.[0] ?? "";
  assert.doesNotMatch(elseBranch, /v_used_minutes:=/i);
  assert.doesNotMatch(elseBranch, /v_used_heavy_minutes:=/i);
});

test("canonical v1 selector preserves the public contract while delegating authority to v2", () => {
  assert.match(adoption, /rename to presented_work_selection_rows_legacy_v1/i);
  assert.match(adoption, /presented_work_selection_rows_legacy_v1/i);
  assert.match(adoption, /select \* from atlas\.presented_work_selection_rows_v2/i);
  assert.match(adoption, /select \* from atlas\.presented_work_rows_v2/i);
  assert.match(adoption, /within_reality_governed_capacity','within_day_capacity'/i);
  assert.match(adoption, /next_up_reality_heavy_capacity','next_up_heavy_capacity'/i);
  assert.match(adoption, /next_up_reality_capacity','next_up_capacity'/i);
});

test("Farm Clock internal readers remain service-only", () => {
  assert.match(candidate, /revoke all on function atlas\.farm_clock_reality_candidates_v1\(uuid,uuid,date\) from public,anon,authenticated/i);
  assert.match(candidate, /grant execute on function atlas\.farm_clock_reality_candidates_v1\(uuid,uuid,date\) to service_role/i);
  assert.match(selector, /revoke all on function atlas\.presented_work_selection_rows_v2\(uuid,uuid,date\) from public,anon,authenticated/i);
  assert.match(adoption, /revoke all on function atlas\.presented_work_selection_rows_v1\(uuid,uuid,date\) from public,anon,authenticated/i);
});

test("Worker Day carries compact Farm Clock reality evidence on both realWork and nextUp", () => {
  assert.match(workerDay, /v_reality jsonb/i);
  assert.match(workerDay, /jsonb_object_agg\(c\.task_id::text/i);
  assert.match(workerDay, /farm_clock_reality_candidates_v1\(p_farm_id,p_membership_id,p_day\)/i);
  assert.match(workerDay, /warrantClass/i);
  assert.match(workerDay, /subjectState/i);
  assert.match(workerDay, /fittingOperation/i);
  assert.match(workerDay, /operationWindow/i);
  assert.match(workerDay, /jurisdiction/i);
  assert.match(workerDay, /truthBoundary/i);
  assert.match(workerDay, /farmClockReality/i);
  assert.match(workerDay, /clockDecision/i);
});
