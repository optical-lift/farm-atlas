import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260804075000_canonicalize_restored_worker_schedule_authority.sql",
    import.meta.url,
  ),
  "utf8",
);

test("schedule restoration reads the worker's existing transition ledger", () => {
  assert.match(migration, /from atlas\.task_transitions transition_row/);
  assert.match(migration, /transition_row\.transition = 'rescheduled'/);
  assert.match(migration, /transition_row\.target_date is not null/);
  assert.match(migration, /actor_membership_id = anna\.id/);
  assert.match(migration, /assigned task page/);
  assert.doesNotMatch(migration, /insert\s+into\s+atlas\.task_transitions/i);
});

test("repair is scoped by stable farm and worker identity", () => {
  assert.match(migration, /stable_key = 'elm_farm'/);
  assert.match(migration, /lower\(coalesce\(membership\.worker_key, ''\)\) = 'anna'/);
  assert.match(migration, /task\.assigned_membership_id/);
  assert.doesNotMatch(migration, /6a503d9f-4008-4ddb-b3f0-cc6ab825dc9f/);
  assert.doesNotMatch(migration, /23e98e5e-16ca-40d8-872c-c77e06baa167/);
});

test("known drifted tasks are selected without broad title rewriting", () => {
  assert.match(migration, /anna_20260728_put_away_cat_litter_food/);
  assert.match(migration, /anna_20260726_set_up_fan_seedlings/);
  assert.match(migration, /anna_20260713_mow_corral_weekly/);
  assert.match(migration, /anna_20260716_divide_lilac_haven_irises_into_drifts/);
  assert.match(migration, /Restore mowing rhythm — Field Rows · Back Half/);
  assert.match(migration, /task\.status in \('open', 'blocked'\)/);
  assert.match(migration, /task\.parent_task_id is null/);
});

test("worker schedule authority replaces later owner and guardrail metadata", () => {
  assert.match(migration, /set due_date = worker_moves\.target_date/);
  assert.match(migration, /- 'owner_rescheduled_at'/);
  assert.match(migration, /- 'owner_rescheduled_to'/);
  assert.match(migration, /- 'owner_rescheduled_reason'/);
  assert.match(migration, /- 'sunday_guardrail_shifted_to'/);
  assert.match(migration, /worker_schedule_restored_to/);
  assert.match(migration, /worker_schedule_transition/);
});

test("a worker-selected Sunday date is preserved explicitly", () => {
  assert.match(
    migration,
    /when extract\(dow from worker_moves\.target_date\) = 0 then true/,
  );
  assert.match(migration, /'allow_sunday'/);
});

test("the released occurrence remains aligned with the canonical task", () => {
  assert.match(migration, /update atlas\.planned_work_occurrences occurrence/);
  assert.match(migration, /planned_due_date = repaired\.due_date/);
  assert.match(migration, /not_before_date = least/);
  assert.match(migration, /\{due_date\}/);
  assert.match(migration, /\{metadata\}/);
  assert.match(migration, /where occurrence\.released_task_id = repaired\.id/);
});
