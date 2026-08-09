import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260809012555_atlas_task_sky_deferral_core_v2.sql");

test("sky deferrability is a first-class task policy", () => {
  assert.match(migration, /sky_deferral_mode text not null default 'auto'/);
  assert.match(migration, /sky_deferral_class text/);
  assert.match(migration, /sky_deferral_horizon_days integer/);
  assert.match(migration, /sky_deferral_anchor_at timestamptz/);
  assert.match(migration, /sky_deferral_reason text/);
  assert.match(migration, /sky_deferral_source text/);
  assert.match(migration, /'auto','allow','never'/);
  assert.match(migration, /'none','short','medium','long'/);
});

test("farm reality revokes sky permission before owner preference", () => {
  const urgent = migration.indexOf("v_task.priority='urgent'");
  const dated = migration.indexOf("v_task.due_date is not null");
  const workflow = migration.indexOf("v_task.work_lane in ('process_continuation','rhythm')");
  const crop = migration.indexOf("elsif v_has_crop_link then");
  const dependency = migration.indexOf("elsif v_has_dependency then");
  const explicitAllow = migration.indexOf("elsif v_mode='allow'");

  for (const protectedSignal of [urgent, dated, workflow, crop, dependency]) {
    assert.ok(protectedSignal >= 0);
    assert.ok(protectedSignal < explicitAllow);
  }

  assert.match(migration, /living_crop_timing_protected/);
  assert.match(migration, /dependency_chain_protected/);
  assert.match(migration, /urgent_farm_priority_protected/);
  assert.match(migration, /live_occurrence_timing_protected/);
});

test("only positively proven flexible work auto-derives as long horizon", () => {
  assert.match(migration, /v_schedule_semantics='floating_eligibility'/);
  assert.match(migration, /v_task.work_lane='discretionary'/);
  assert.match(migration, /derived_floating_eligibility_long_horizon/);
  assert.match(migration, /no_positive_long_horizon_signal/);
});

test("maximum deferral is cumulative rather than resetting every sky window", () => {
  assert.match(migration, /v_deadline := v_anchor \+ make_interval\(days=>v_horizon\)/);
  assert.match(migration, /if v_at >= v_deadline then/);
  assert.match(migration, /deferral_horizon_expired/);
  assert.match(migration, /v_next <= v_deadline/);
  assert.match(migration, /next_favored_window_beyond_cumulative_deferral_deadline/);
});

test("iris pilot is explicitly long-horizon for thirty days", () => {
  assert.match(migration, /sky_deferral_mode='allow'/);
  assert.match(migration, /sky_deferral_class='long'/);
  assert.match(migration, /sky_deferral_horizon_days=30/);
  assert.match(migration, /anna_20260716_divide_lilac_haven_irises_into_drifts/);
});

test("new sky deferral logic never uses legacy effort units", () => {
  assert.doesNotMatch(migration, /effort_units/);
});
