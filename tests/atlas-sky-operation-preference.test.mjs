import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("iris division promotes only common-mode timing as a non-blocking preference", () => {
  const rule = read("supabase/migrations/20260809004333_atlas_iris_common_mode_preference_v1.sql");
  const farmDateFix = read("supabase/migrations/20260809004348_atlas_iris_common_mode_preference_farm_date_fix_v1.sql");

  assert.match(rule, /elm_divide_reestablish_common_mode_preference_v1/);
  assert.match(rule, /'approved'/);
  assert.match(rule, /'preferred'/);
  assert.match(rule, /\{"moon_mode_in":\["common"\]\}/);
  assert.match(rule, /'working_reconstruction'/);
  assert.match(rule, /'worker_withholding_authorized',false/);
  assert.match(rule, /'moon_phase_rule_used',false/);
  assert.match(rule, /where stable_key='elm_iris_division_window_v1'/);
  assert.match(rule, /strict Windowed rule inactive/i);
  assert.doesNotMatch(rule.match(/'\{"moon_mode_in":\["common"\]\}'::jsonb/)?.[0] ?? "", /phase_state_in|waxing|waning/);

  assert.match(farmDateFix, /metadata->>'timezone'/);
  assert.match(farmDateFix, /at time zone/);
});

test("Preferred sky fitness is a tie-break after obligation, due-state, and farm priority", () => {
  const migration = read("supabase/migrations/20260809004810_atlas_preferred_sky_tiebreak_v1.sql");
  const rankedStart = migration.indexOf("regular_ranked as");
  const rankedEnd = migration.indexOf("regular_selected as", rankedStart);
  const ranked = migration.slice(rankedStart, rankedEnd);

  assert.match(migration, /sky_preference_order/);
  assert.match(migration, /enforcementMode','preferred'/);
  assert.match(migration, /fitness','favored'/);
  assert.ok(ranked.indexOf("effective_obligation_class") < ranked.indexOf("sky_preference_order"));
  assert.ok(ranked.indexOf("due_date=v_work_date") < ranked.indexOf("sky_preference_order"));
  assert.ok(ranked.indexOf("priority_order") < ranked.indexOf("sky_preference_order"));
  assert.match(migration, /Preferred sky fitness is a tie-break only after obligation\/due\/priority truth/);
});
