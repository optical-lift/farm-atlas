import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const presentationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260804073850_show_overdue_without_counting_worker_reschedules.sql",
    import.meta.url,
  ),
  "utf8",
);

const legacyMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260804074237_recognize_legacy_worker_reschedules.sql",
    import.meta.url,
  ),
  "utf8",
);

const canonicalizationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260804075000_canonicalize_restored_worker_schedule_authority.sql",
    import.meta.url,
  ),
  "utf8",
);

test("overdue work remains visible instead of being suppressed by the minute budget", () => {
  assert.match(
    presentationMigration,
    /task\.due_date < v_work_date[\s\S]*row\.presentation_state = 'held'[\s\S]*held_beyond_regular_minutes[\s\S]*held_beyond_recovery_minutes[\s\S]*then 'presented'/,
  );
  assert.match(presentationMigration, /overdue_visible_over_capacity/);
});

test("worker-authored overdue reschedules remain visible without counting toward the day", () => {
  assert.match(
    presentationMigration,
    /atlas\.task_rescheduled_by_membership_v1\(task\.id, p_membership_id, v_target_worker_key\)/,
  );
  assert.match(
    presentationMigration,
    /overdue_rescheduled_visible_noncounting/,
  );
  assert.match(
    presentationMigration,
    /when accounting\.noncounting_overdue then false/,
  );
});

test("capacity reporting preserves measured backlog while excluding it from selected workload", () => {
  assert.match(presentationMigration, /'countsTowardDay',not accounting\.noncounting_overdue/);
  assert.match(presentationMigration, /'capacityTreatment',case/);
  assert.match(presentationMigration, /'overdue_rescheduled_noncounting'/);
  assert.match(
    presentationMigration,
    /selectedRegularMinutes'[\s\S]*selectedRecoveryMinutes'[\s\S]*selectedTotalMinutes'/,
  );
  assert.match(presentationMigration, /noncountingOverdueMinutes/);
  assert.match(presentationMigration, /noncountingOverdueCount/);
  assert.match(
    presentationMigration,
    /presented\.presentation_state='presented'[\s\S]*not accounting\.noncounting_overdue[\s\S]*capacity\.effective_obligation_class<>'recovery_work'/,
  );
  assert.match(
    presentationMigration,
    /presented\.presentation_state='presented'[\s\S]*not accounting\.noncounting_overdue[\s\S]*capacity\.effective_obligation_class='recovery_work'/,
  );
});

test("legacy assigned-task-page moves are recognized only when the task still belongs to that worker", () => {
  assert.match(legacyMigration, /transition_row\.actor_membership_id is null/);
  assert.match(legacyMigration, /assigned task page/);
  assert.match(legacyMigration, /task\.assigned_membership_id = p_membership_id/);
  assert.match(legacyMigration, /executor_membership_id/);
  assert.match(legacyMigration, /assigneeKey/);
});

test("restoration uses stable farm and worker identity rather than generated production IDs", () => {
  const combined = `${presentationMigration}\n${legacyMigration}\n${canonicalizationMigration}`;
  assert.match(combined, /stable_key = 'elm_farm'/);
  assert.match(combined, /lower\(coalesce\(membership\.worker_key, ''\)\) = 'anna'/);
  assert.doesNotMatch(combined, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
  assert.doesNotMatch(combined, /6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f/);
});

test("the corrected dates come from existing worker transitions without fabricating move history", () => {
  assert.match(canonicalizationMigration, /from atlas\.task_transitions transition_row/);
  assert.match(canonicalizationMigration, /transition_row\.transition = 'rescheduled'/);
  assert.doesNotMatch(canonicalizationMigration, /insert\s+into\s+atlas\.task_transitions/i);
  assert.match(canonicalizationMigration, /worker_schedule_transition/);
  assert.match(canonicalizationMigration, /worker_schedule_restored_reason/);
});

test("the released occurrence is synchronized with the restored task date", () => {
  assert.match(canonicalizationMigration, /update atlas\.planned_work_occurrences occurrence/);
  assert.match(canonicalizationMigration, /planned_due_date = repaired\.due_date/);
  assert.match(canonicalizationMigration, /not_before_date = least/);
  assert.match(canonicalizationMigration, /\{due_date\}/);
  assert.match(canonicalizationMigration, /\{metadata\}/);
});

test("the known drifted Anna tasks are included in the repair", () => {
  const combined = `${presentationMigration}\n${legacyMigration}\n${canonicalizationMigration}`;
  assert.match(combined, /anna_20260728_put_away_cat_litter_food/);
  assert.match(combined, /Restore mowing rhythm — Field Rows · Back Half/);
  assert.match(combined, /anna_20260726_set_up_fan_seedlings/);
  assert.match(combined, /anna_20260713_mow_corral_weekly/);
  assert.match(combined, /anna_20260716_divide_lilac_haven_irises_into_drifts/);
  assert.match(combined, /date '2026-07-29'/);
  assert.match(combined, /date '2026-08-03'/);
});
