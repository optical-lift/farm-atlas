import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Harvest replaces Projects in the primary dock while Projects remains in More", () => {
  const frame = read("components/atlas/shell/AtlasContextualAppFrame.tsx");
  const more = read("app/more/page.tsx");

  assert.match(frame, /key:\s*"harvest"[\s\S]*label:\s*"Harvest"[\s\S]*href:\s*"\/harvest"/);
  assert.doesNotMatch(frame, /key:\s*"projects"/);
  assert.match(more, /label:\s*"Projects"[\s\S]*href:\s*"\/projects"/);
});

test("Harvest Horizon reads real crop projections and independent field evidence", () => {
  const api = read("app/api/atlas/harvest-horizon/route.ts");
  const page = read("app/harvest/page.tsx");

  assert.match(api, /crop_cycle_yield_forecast/);
  assert.match(api, /crop_observations/);
  assert.match(api, /crop_harvest_availability/);
  assert.match(api, /crop_harvest_events/);
  assert.match(api, /calculated/);
  assert.match(api, /seen/);
  assert.match(api, /confirmed/);
  assert.match(page, /Harvest Horizon/);
  assert.match(page, /Date lens/);
  assert.match(page, /What should be available by a particular day/);
});

test("Harvest sightings write observations rather than completing forecast tasks", () => {
  const api = read("app/api/atlas/harvest-horizon/route.ts");
  const page = read("app/harvest/page.tsx");

  assert.match(api, /record_crop_observation_v1/);
  assert.match(api, /harvest-horizon-observation-v1/);
  assert.match(api, /first_harvest/);
  assert.match(api, /peak_harvest/);
  assert.doesNotMatch(api, /record_task_transition/);
  assert.match(page, /Record what the field is doing/);
  assert.match(page, /Still green/);
  assert.match(page, /First cut \/ pick/);
});

test("Forecast-only harvest watch cards are suppressed without hiding real harvest work", () => {
  const migration = read("supabase/migrations/20260801213000_atlas_harvest_horizon_v1.sql");

  assert.match(migration, /create or replace function atlas\.suppress_harvest_watch_task_v1/);
  assert.match(migration, /task_type = 'harvest_horizon_marker'/);
  assert.match(migration, /visibility_scope = 'system_internal'/);
  assert.match(migration, /lower\(coalesce\(task_type, ''\)\) = 'harvest_watch'/);
  assert.doesNotMatch(migration, /task_type = 'crop_harvest'/);
  assert.doesNotMatch(migration, /create or replace function atlas\.ensure_crop_harvest_task_v1/);
});

test("Harvest horizon entries become grouped Bell movement with a Harvest deep link", () => {
  const migration = read("supabase/migrations/20260801213000_atlas_harvest_horizon_v1.sql");

  assert.match(migration, /create or replace function atlas\.harvest_horizon_tick_v1/);
  assert.match(migration, /group by farm_id, organization_id, crop_key, variety, window_start, window_end/);
  assert.match(migration, /p_event_kind => 'production_change'/);
  assert.match(migration, /p_source_event => 'harvest_horizon_entry'/);
  assert.match(migration, /return '\/harvest'/);
  assert.match(migration, /atlas-harvest-horizon-daily-v1/);
});

test("Harvest keeps a single page scroll on small screens", () => {
  const css = read("app/harvest/harvest.css");

  assert.doesNotMatch(css, /overflow-y:\s*(?:auto|scroll)/);
  assert.match(css, /@media \(max-width: 620px\)/);
});
