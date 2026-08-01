import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const foundation = read("supabase/migrations/20260801023000_atlas_task_notification_plan_foundation_v1.sql");
const preferences = read("supabase/migrations/20260801023030_atlas_task_notification_preferences_and_clock_v1.sql");
const contract = read("lib/atlas/push-contract.ts");
const setup = read("components/atlas/pwa/AtlasPwaSetup.tsx");
const install = read("app/install/page.tsx");

test("owner and manager daily delivery is required while employee preview and friendly nudges remain optional", () => {
  assert.match(foundation, /when p_role in \('owner', 'manager'\) then array\[/);
  assert.match(foundation, /'tomorrow_covered', 'day_plan', 'work_window', 'window_closing'/);
  assert.match(foundation, /else array\[\s*'work_window', 'window_closing', 'dependency_ready'/s);
  assert.match(foundation, /else array\[\s*'day_plan', 'task_nudge', 'day_wrap'/s);
  assert.match(foundation, /'canPauseAll', false/);
});

test("the server refuses to disable required categories or pause Atlas delivery", () => {
  assert.match(preferences, /enabled = true/);
  assert.match(preferences, /for v_required_key in select jsonb_array_elements_text/);
  assert.match(preferences, /jsonb_set\(v_categories, array\[v_required_key\], 'true'::jsonb, true\)/);
  assert.match(preferences, /'enabled', true/);
  assert.doesNotMatch(preferences, /enabled = coalesce\(p_enabled/i);
});

test("push setup exposes the role policy and tomorrow coverage contract", () => {
  assert.match(preferences, /'contractVersion', 'atlas_web_push_v2'/);
  assert.match(preferences, /'role', v_role/);
  assert.match(preferences, /'categoryPolicy', v_policy/);
  assert.match(preferences, /'tomorrowCoverage', atlas\.task_notification_coverage_v1/);
  assert.match(contract, /export type AtlasPushCategoryPolicy/);
  assert.match(contract, /export type AtlasTomorrowCoverage/);
  assert.match(contract, /contractVersion: "atlas_web_push_v1" \| "atlas_web_push_v2"/);
});

test("the app shows locked required notifications and editable optional extras", () => {
  assert.match(setup, /requiredCategories\.map/);
  assert.match(setup, /checked readOnly disabled/);
  assert.match(setup, /Required<\/span>/);
  assert.match(setup, /optionalCategories\.map/);
  assert.match(setup, /categories: \{ \.\.\.preferences\.categories, \[category\]: event\.target\.checked \}/);
  assert.doesNotMatch(setup, /Allow Atlas Farm Alerts/);
  assert.doesNotMatch(setup, /setPreferences\(\{ \.\.\.preferences, enabled: event\.target\.checked \}\)/);
});

test("the app states the lockscreen promise and renders tomorrow coverage", () => {
  assert.match(setup, /Atlas will deliver assigned work to this lockscreen/);
  assert.match(setup, /Tomorrow is covered/);
  assert.match(setup, /coverage\.taskCount/);
  assert.match(setup, /coverage\.momentCount/);
  assert.match(setup, /coverage\.uncoveredTaskCount/);
  assert.match(setup, /Required process timers, work releases, and closing-window warnings may still arrive during quiet hours/);
  assert.match(install, /Let Atlas carry the workday/);
  assert.match(install, /Required work delivery stays on/);
});

test("all daily and dependency categories are represented in the client contract", () => {
  for (const category of [
    "dependency_ready",
    "tomorrow_covered",
    "day_plan",
    "work_window",
    "task_nudge",
    "window_closing",
    "day_wrap",
  ]) {
    assert.match(contract, new RegExp(`\\| "${category}"`));
  }
});
