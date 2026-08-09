import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260809014115_atlas_operation_sky_policy_library_v1.sql");

test("operation sky library covers every canonical operation class", () => {
  const classes = [
    "apply_treatment",
    "build_establish_structure",
    "clean_restore",
    "clear_demolish",
    "cultivate_prepare",
    "cut_separate",
    "divide_reestablish_belowground",
    "establish_aboveground",
    "establish_belowground",
    "harvest_aboveground",
    "harvest_belowground",
    "inspect_assess",
    "process_postharvest",
    "remove_uproot",
    "repair_restore",
    "retain_strengthen",
    "water_nourish",
  ];
  for (const operationClass of classes) assert.ok(migration.includes(`('${operationClass}'`));
});

test("only iris-style division receives Windowed authority", () => {
  assert.match(migration, /'divide_reestablish_belowground','windowed'/);
  assert.match(migration, /worker_withholding_supported/);
  assert.match(migration, /withholding_requires_deferrability/);
  assert.equal((migration.match(/,'windowed'/g) ?? []).length, 1);
});

test("reconstructed mode grammar is preference-only outside the iris pilot", () => {
  for (const stableKey of [
    "atlas_build_establish_structure_fixed_preference_v1",
    "atlas_clear_demolish_moveable_preference_v1",
    "atlas_cultivate_prepare_common_preference_v1",
    "atlas_cut_separate_moveable_preference_v1",
    "atlas_establish_aboveground_fixed_preference_v1",
    "atlas_establish_belowground_fixed_preference_v1",
    "atlas_remove_uproot_moveable_preference_v1",
    "atlas_repair_restore_fixed_preference_v1",
    "atlas_retain_strengthen_fixed_preference_v1",
  ]) assert.ok(migration.includes(stableKey));

  assert.match(migration, /'preferred'/);
  assert.match(migration, /'worker_withholding_authorized',false/);
  assert.match(migration, /Biological timing always outranks|biological timing always outranks|biological timing remains authoritative/i);
});

test("need, observation, postharvest, treatment, cleaning, and harvest stay non-blocking", () => {
  assert.match(migration, /'apply_treatment','informative'/);
  assert.match(migration, /'clean_restore','informative'/);
  assert.match(migration, /'harvest_aboveground','informative'/);
  assert.match(migration, /'harvest_belowground','informative'/);
  assert.match(migration, /'inspect_assess','no_rule'/);
  assert.match(migration, /'process_postharvest','no_rule'/);
  assert.match(migration, /'water_nourish','no_rule'/);
  assert.match(migration, /does not backdate a modern waning-equals-release formula/);
});

test("Preferred sky ranking is evaluated for dated operation tasks without granting withholding", () => {
  const planner = read("supabase/migrations/20260809014403_atlas_preferred_sky_all_operation_tasks_v1.sql");
  assert.match(planner, /when t\.status='open' and t\.operation_class is not null/);
  assert.match(planner, /then atlas\.task_sky_presentation_gate_v1\(t\.id,v_work_date\)/);
  assert.doesNotMatch(planner, /t\.commitment_kind='floating'[\s\S]{0,80}t\.due_date is null[\s\S]{0,80}task_sky_presentation_gate_v1/);
  assert.match(planner, /sky_preference_order/);
  assert.match(planner, /Farm timezone comes from farm metadata with Chicago only as fallback/);
});
