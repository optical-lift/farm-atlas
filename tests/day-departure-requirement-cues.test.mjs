import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260811183000_atlas_departure_requirement_cues_v1.sql");
const focusDelivery = read("app/task-focus/[taskId]/TaskFocusCueDelivery.tsx");

test("Lebanon load truth lives in canonical resources and task requirements", () => {
  assert.match(migration, /general_saw/);
  assert.match(migration, /air_compressor/);
  assert.match(migration, /regular_metal_rake_wood_handle/);
  assert.match(migration, /black_florist_buckets/);
  assert.match(migration, /task_resource_requirements/);
  assert.match(migration, /5 black florist buckets/);
  assert.match(migration, /7 black florist buckets/);
  assert.match(migration, /departure_requirements_source','task_resource_requirements/);
});

test("Before cue content is assembled from resource requirements rather than hardcoded JSX", () => {
  assert.match(migration, /refresh_task_departure_requirement_cue_v1/);
  assert.match(migration, /jsonb_agg/);
  assert.match(migration, /resource\.label/);
  assert.match(migration, /req\.metadata->>'cue_label'/);
  assert.match(migration, /Before you leave for /);
  assert.match(focusDelivery, /activeCue\.payload\.items/);
  assert.doesNotMatch(focusDelivery, /Saw|Air compressor|florist buckets/);
});

test("missed-app recovery asks current destination reality instead of creating a missed preparation task", () => {
  assert.match(migration, /recoveryPrompt','Are these with you in /);
  assert.match(migration, /cue\.service_date<p_day/);
  assert.match(migration, /then 'stale'/);
  assert.match(migration, /recovery_policy in \('refresh','persist','block'\)/);
  assert.doesNotMatch(migration, /overdue/i);
});

test("a missing departure requirement creates a real blocker without mutating canonical resource inventory", () => {
  assert.match(migration, /requirement_confirmation_v1/);
  assert.match(migration, /status='blocked'/);
  assert.match(migration, /day_requirement_blocker/);
  assert.match(migration, /status='reserved'/);
  assert.match(migration, /status='needs_check'/);
  assert.doesNotMatch(migration, /update atlas\.resources\s+set status='missing'/i);
});
