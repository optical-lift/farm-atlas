import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("historical Preferred support remains a safe tiebreak capability", () => {
  const migration = read("supabase/migrations/20260809004810_atlas_preferred_sky_tiebreak_v1.sql");
  const rankedStart = migration.indexOf("regular_ranked as");
  const rankedEnd = migration.indexOf("regular_selected as", rankedStart);
  const ranked = migration.slice(rankedStart, rankedEnd);

  assert.match(migration, /sky_preference_order/);
  assert.match(migration, /enforcementMode[^\n]*preferred/);
  assert.match(migration, /fitness[^\n]*favored/);
  assert.ok(ranked.indexOf("effective_obligation_class") < ranked.indexOf("sky_preference_order"));
  assert.ok(ranked.indexOf("due_date=v_work_date") < ranked.indexOf("sky_preference_order"));
  assert.ok(ranked.indexOf("priority_order") < ranked.indexOf("sky_preference_order"));
  assert.match(migration, /Preferred sky fitness is a tie-break only after obligation\/due\/priority truth/);
});

test("current iris policy is Windowed only for genuinely deferrable work", () => {
  const migration = read("supabase/migrations/20260809011103_atlas_sky_deferrability_and_iris_window_v1.sql");

  assert.match(migration, /task_sky_deferral_policy_v1/);
  assert.match(migration, /'dated_or_biologically_timed'/);
  assert.match(migration, /'process_continuation_protected'/);
  assert.match(migration, /'no_long_horizon_deferral_authority'/);
  assert.match(migration, /'sky_deferral_class','long_horizon'/);
  assert.match(migration, /'sky_deferral_horizon_days',30/);
  assert.match(migration, /elm_divide_reestablish_common_mode_window_v1/);
  assert.match(migration, /'windowed'/);
  assert.match(migration, /'moon_mode_in',jsonb_build_array\('common'\)/);
  assert.match(migration, /'owner_operating_hypothesis'/);
  assert.match(migration, /Biological timing, hard commitments, dependencies, and dated work outrank sky preference/);
  assert.match(migration, /next_favored_window_beyond_safe_deferral_horizon/);
  assert.match(migration, /next_favored_window_unknown_fail_open/);
});
