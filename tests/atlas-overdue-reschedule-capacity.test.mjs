import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260804073000_show_overdue_noncounting_reschedules.sql",
    import.meta.url,
  ),
  "utf8",
);

function functionBody(name, nextName) {
  const start = migration.indexOf(`create or replace function atlas.${name}`);
  const end = nextName
    ? migration.indexOf(`create or replace function atlas.${nextName}`, start)
    : migration.length;
  assert.ok(start >= 0, `${name} must exist`);
  return migration.slice(start, end > start ? end : migration.length);
}

const workerReschedule = functionBody(
  "task_rescheduled_by_membership_v1",
  "presented_work_rows_v1",
);
const presentedWork = functionBody(
  "presented_work_rows_v1",
  "owner_capacity_plan_v1",
);
const ownerCapacity = functionBody("owner_capacity_plan_v1", null);

test("worker reschedule identity includes current and legacy assigned-task-page evidence", () => {
  assert.match(workerReschedule, /actor_membership_id = p_membership_id/);
  assert.match(
    workerReschedule,
    /payload ->> 'actor_membership_id' = p_membership_id::text/,
  );
  assert.match(workerReschedule, /actor_membership_id is null/);
  assert.match(workerReschedule, /assigned task page/);
  assert.match(workerReschedule, /task\.assigned_membership_id = p_membership_id/);
  assert.match(workerReschedule, /payload ->> 'assigneeKey'/);
});

test("overdue work is visible even when minute capacity would otherwise hold it", () => {
  assert.match(
    presentedWork,
    /task\.due_date < v_work_date[\s\S]*row\.presentation_state = 'held'[\s\S]*held_beyond_regular_minutes[\s\S]*then 'presented'/,
  );
  assert.match(presentedWork, /overdue_visible_over_capacity/);
  assert.match(presentedWork, /overdue_rescheduled_visible_noncounting/);

  // Future, owner-review, and superseded rhythm rows are still governed by the
  // unfiltered resolver; this wrapper only promotes explicit-date or overdue
  // rows held by capacity.
  assert.doesNotMatch(
    presentedWork,
    /row\.presentation_reason in \([^)]*future[^)]*\)[\s\S]*then 'presented'/,
  );
  assert.doesNotMatch(
    presentedWork,
    /row\.presentation_reason in \([^)]*owner_review[^)]*\)[\s\S]*then 'presented'/,
  );
});

test("explicit due-date work remains mandatory regardless of capacity", () => {
  assert.match(
    presentedWork,
    /task\.due_date = v_work_date[\s\S]*row\.presentation_state = 'held'[\s\S]*then 'presented'/,
  );
  assert.match(presentedWork, /explicit_due_date_over_capacity/);
});

test("Anna-rescheduled overdue work is visible but excluded from day totals", () => {
  assert.match(ownerCapacity, /'countsTowardDay',not accounting\.noncounting_overdue/);
  assert.match(ownerCapacity, /'overdue_rescheduled_noncounting'/);
  assert.match(
    ownerCapacity,
    /selectedRegularMinutes[\s\S]*selectedRecoveryMinutes[\s\S]*selectedTotalMinutes/,
  );
  assert.match(ownerCapacity, /and not accounting\.noncounting_overdue/);
  assert.match(ownerCapacity, /noncountingOverdueMinutes/);
  assert.match(ownerCapacity, /noncountingOverdueCount/);
});

test("worker-facing cards do not expose private capacity arithmetic", () => {
  assert.doesNotMatch(
    presentedWork.match(/row\.task_card[\s\S]*?order by row\.lane_order/)?.[0] ?? "",
    /countsTowardDay|capacityTreatment|expectedActiveMinutes|noncountingOverdueMinutes/,
  );
});
