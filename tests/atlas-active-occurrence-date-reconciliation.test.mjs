import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811231500_active_occurrence_date_reconciliation_v1.sql", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();

test("canonical reschedules keep the released occurrence on the same current date", () => {
  assert.match(migration, /create or replace function atlas\.sync_rescheduled_task_occurrence_v1/);
  assert.match(migration, /new\.transition not in \('rescheduled','unfinished'\)/);
  assert.match(migration, /set planned_due_date=new\.target_date/);
  assert.match(migration, /occurrence\.not_before_date=occurrence\.planned_due_date/);
  assert.match(migration, /v_task\.planned_occurrence_id/);
  assert.match(migration, /occurrence\.released_task_id=new\.task_id/);
});

test("historical-release provenance is never converted into a current schedule claim", () => {
  const occurrences = migration.match(/historical_release_provenance/g) ?? [];
  assert.ok(occurrences.length >= 3, "all synchronization/backfill paths must preserve explicit historical occurrence dates");
});

test("Sunday guardrail gets a post-task synchronization path", () => {
  assert.match(migration, /create or replace function atlas\.sync_sunday_guardrail_occurrence_v1/);
  assert.match(migration, /after insert or update of due_date,metadata,planned_occurrence_id on atlas\.tasks/);
  assert.match(migration, /sunday_guardrail_applied/);
  assert.match(migration, /sunday_guardrail_original_due_date/);
  assert.match(migration, /set planned_due_date=new\.due_date/);
  assert.match(migration, /sunday_guardrail_current_schedule/);
  assert.match(migration, /lower\(coalesce\(new\.metadata->>'sunday_guardrail_applied','false'\)\)/);
});

test("historical backfill requires decisive canonical transition evidence", () => {
  assert.match(normalized, /task\.status in \('open','blocked'\)/);
  assert.match(normalized, /task\.due_date=latest\.target_date/);
  assert.match(normalized, /occurrence\.state='released'/);
  assert.match(normalized, /occurrence\.released_task_id=task\.id/);
  assert.match(normalized, /occurrence\.planned_due_date is distinct from latest\.target_date/);
  assert.match(migration, /active_schedule_reconciled_from_transition/);
});

test("backfill does not infer scheduling intent from names or generated ids", () => {
  assert.doesNotMatch(migration, /School and Preschool Enrollment/);
  assert.doesNotMatch(migration, /Grow Room Care/);
  assert.doesNotMatch(migration, /Marshall/);
  assert.doesNotMatch(migration, /Asparagus/);
  assert.doesNotMatch(migration, /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/i);
});
