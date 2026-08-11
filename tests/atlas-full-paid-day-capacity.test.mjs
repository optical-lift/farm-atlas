import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const capacityMigration = readFileSync(
  new URL("../supabase/migrations/20260809013600_full_paid_day_capacity_contract.sql", import.meta.url),
  "utf8",
);
const projectionMigration = readFileSync(
  new URL("../supabase/migrations/20260809013700_fill_owner_week_projection_to_paid_capacity.sql", import.meta.url),
  "utf8",
);
const personalMigration = readFileSync(
  new URL("../supabase/migrations/20260809013800_mark_personal_tasks_in_day_presentation.sql", import.meta.url),
  "utf8",
);
const batchMigration = readFileSync(
  new URL("../supabase/migrations/20260809013900_scale_batch_work_and_passive_preparation_capacity.sql", import.meta.url),
  "utf8",
);
const fullDayProjectMigration = readFileSync(
  new URL("../supabase/migrations/20260809022500_full_paid_day_project_capacity_v2.sql", import.meta.url),
  "utf8",
);
const backlogMigration = readFileSync(
  new URL("../supabase/migrations/20260809023500_count_unfinished_backlog_without_lowering_expectation_v1.sql", import.meta.url),
  "utf8",
);
const projectionReader = readFileSync(
  new URL("../lib/atlas-data/owner-week-projection.ts", import.meta.url),
  "utf8",
);
const dayPlanReader = readFileSync(
  new URL("../lib/atlas/worker-day-plan-server.ts", import.meta.url),
  "utf8",
);
const dayPlanRoute = readFileSync(
  new URL("../app/api/atlas/worker-day-plan/route.ts", import.meta.url),
  "utf8",
);
const dayPlanMigration = readFileSync(
  new URL("../supabase/migrations/20260809203000_owner_worker_day_plan_kernel_v1.sql", import.meta.url),
  "utf8",
);
const choreographyMigration = readFileSync(
  new URL("../supabase/migrations/20260811160000_atlas_day_choreography_plan_overlay_v1.sql", import.meta.url),
  "utf8",
);
const projectionUi = readFileSync(
  new URL("../components/atlas/owner-day-schedule-builder.tsx", import.meta.url),
  "utf8",
);

test("Anna retains a full paid-work target regardless of prior completion", () => {
  assert.match(capacityMigration, /regular_target_minutes = 420/);
  assert.match(capacityMigration, /maximum_planned_minutes = 480/);
  assert.match(capacityMigration, /completion_history_may_reduce_target', false/);
  assert.match(capacityMigration, /paid_active_target_minutes', 420/);
  assert.match(backlogMigration, /'workerUndercompletionLowersTomorrowTarget',false/);
  assert.match(backlogMigration, /'undercompletionLowersFutureTarget',false/);
  assert.doesNotMatch(capacityMigration, /six[_ -]?unit/i);
});

test("personal obligations and micro observations remain visible without filling paid capacity", () => {
  assert.match(capacityMigration, /School and Preschool Enrollment/);
  assert.match(capacityMigration, /Grey Couch in Garage/);
  assert.match(capacityMigration, /personal_noncounting/);
  assert.match(capacityMigration, /micro_round_key = 'grow_room_observation'/);
  assert.match(capacityMigration, /expected_active_minutes := 0/);
  assert.match(personalMigration, /'display_family', 'Personal'/);
});

test("small passive or local prep does not masquerade as a large work block", () => {
  assert.match(capacityMigration, /Mowing — Follow Me Paths \+ Edges/);
  assert.match(capacityMigration, /20, 'light', 'routine_production'/);
  assert.match(capacityMigration, /owner_calibrated:follow_me_mowing/);
  assert.match(batchMigration, /Charge DeWalt Batteries for Mowing/);
  assert.match(batchMigration, /5, 'light', 'optional_improvement'/);
  assert.match(batchMigration, /passive_elapsed_time_noncounting/);
});

test("consolidated batch parents retain the labor of all required batch items", () => {
  assert.match(batchMigration, /batch_item_count/);
  assert.match(batchMigration, /task_work_shape/);
  assert.match(batchMigration, /expected_active_minutes := expected_active_minutes \* v_batch_count/);
  assert.match(batchMigration, /\+batch_x/);
  assert.match(batchMigration, /owner_locked, false/);
});

test("owner projection keeps selecting compatible project work until paid capacity is substantially filled", () => {
  assert.match(projectionMigration, /project_pull_options_for_member_v2/);
  assert.match(fullDayProjectMigration, /for v_iteration in 1\.\.24 loop/);
  assert.match(fullDayProjectMigration, /exit when v_remaining<=15/);
  assert.match(fullDayProjectMigration, /projectPullBudgetMinutes',v_budget/);
  assert.match(fullDayProjectMigration, /v_budget := v_remaining/);
  assert.match(fullDayProjectMigration, /v_remaining:=greatest\(v_remaining-v_option_minutes,0\)/);
  assert.doesNotMatch(fullDayProjectMigration, /six[_ -]?unit/i);
});

test("rescheduled unfinished work remains paid backlog instead of becoming permission for a smaller day", () => {
  assert.match(backlogMigration, /overdue_backlog_counted/);
  assert.match(backlogMigration, /workerRescheduledBacklogMinutes/);
  assert.match(backlogMigration, /backlogPaidMinutes/);
  assert.match(backlogMigration, /heldPaidMinutes/);
  assert.match(backlogMigration, /openPaidObligationMinutes/);
  assert.match(backlogMigration, /obligationBeyondPaidTargetMinutes/);
  assert.match(backlogMigration, /'workerRescheduleErasesObligation',false/);
  assert.match(backlogMigration, /'heldWorkStillExists',true/);
  assert.match(backlogMigration, /'noncountingOverdueMinutes',0/);
  assert.doesNotMatch(backlogMigration, /overdue_rescheduled_noncounting/);
});

// Owner purple editing now commits through one transaction boundary; the old
// schedule/edit routes remain compatibility APIs, not the active board write path.
test("Owner sees the full paid-day plan while choreography changes presentation and only discretionary fill needs approval", () => {
  assert.match(projectionReader, /paidTargetMinutes/);
  assert.match(dayPlanReader, /owner_worker_day_plan_choreographed_api_v1/);
  assert.match(dayPlanRoute, /readOwnerWorkerDayPlan/);
  assert.match(dayPlanMigration, /paidTargetMinutes/);
  assert.match(dayPlanMigration, /committedPaidMinutes/);
  assert.match(dayPlanMigration, /automaticPaidMinutes/);
  assert.match(dayPlanMigration, /remainingPaidMinutes/);
  assert.match(dayPlanMigration, /floating_paid_work_candidates_v1/);
  assert.match(dayPlanMigration, /project_pull_items/);
  assert.match(dayPlanMigration, /dayWindow/);
  assert.match(dayPlanMigration, /workOrderNumber/);
  assert.match(choreographyMigration, /owner_worker_day_plan_v1\(p_farm_id,p_membership_id,p_day\)/);
  assert.match(choreographyMigration, /committedPaidMinutes/);
  assert.match(choreographyMigration, /remainingPaidMinutes/);
  assert.match(projectionUi, /paidTargetMinutes/);
  assert.match(projectionUi, /committedPaidMinutes/);
  assert.match(projectionUi, /automaticPaidMinutes/);
  assert.match(projectionUi, /selectedCandidates/);
  assert.match(projectionUi, /\/api\/atlas\/owner-day-commit/);
  assert.match(projectionUi, /owner-day-commit-v1/);
  assert.doesNotMatch(projectionUi, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(projectionUi, /fetch\("\/api\/atlas\/owner-day-edit"/);
  assert.match(projectionUi, /Return to Atlas/);
});
