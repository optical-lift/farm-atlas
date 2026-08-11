import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811224500_sync_rescheduled_task_occurrence_truth_v1.sql", import.meta.url),
  "utf8",
);

test("canonical task reschedules keep a linked released occurrence on the same operational date", () => {
  assert.match(migration, /after insert on atlas\.task_transitions/);
  assert.match(migration, /new\.transition in \('rescheduled','unfinished'\)/);
  assert.match(migration, /new\.target_date is not null/);
  assert.match(migration, /metadata->>'planned_occurrence_id'/);
  assert.match(migration, /occurrence\.released_task_id=new\.task_id/);
  assert.match(migration, /occurrence\.state='released'/);
  assert.match(migration, /planned_due_date=new\.target_date/);
});

test("an occurrence's independent not-before gate is preserved unless it followed the prior task date", () => {
  assert.match(migration, /occurrence\.not_before_date is null/);
  assert.match(migration, /occurrence\.not_before_date=new\.previous_due_date/);
  assert.match(migration, /then new\.target_date/);
  assert.match(migration, /else occurrence\.not_before_date/);
});

test("reschedule history stays auditable rather than erasing the original date", () => {
  assert.match(migration, /last_operational_reschedule/);
  assert.match(migration, /'previous_due_date',new\.previous_due_date/);
  assert.match(migration, /'transition_id',new\.id/);
  assert.match(migration, /'target_date',new\.target_date/);
});

test("the known iris split truth is reconciled through the canonical transition engine", () => {
  assert.match(migration, /anna_20260716_lilac_haven_front_iris_clump_2/);
  assert.match(migration, /metadata->>'owner_rescheduled_to'/);
  assert.match(migration, /metadata->>'owner_rescheduled_reason'/);
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.match(migration, /'rescheduled'/);
  assert.match(migration, /atlas_rescheduled_occurrence_truth_v1/);
  assert.doesNotMatch(migration, /9f5638d2-3606-4a5a-aa24-e48553fb2858/);
  assert.doesNotMatch(migration, /5520e615-8a08-4dfe-8e85-edd60baa0a4d/);
});
