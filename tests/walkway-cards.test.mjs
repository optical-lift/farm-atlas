import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Walkway Cards preserve strategy, observation, and the seven-day spray Clock", () => {
  const migration = read("supabase/migrations/20260730042000_permanent_walkway_cards_v1.sql");
  const occurrenceMigration = read("supabase/migrations/20260730043000_walkway_card_occurrence_link_v1.sql");

  assert.match(migration, /create table if not exists atlas\.walkway_cards/);
  assert.match(migration, /strategy in \('spray', 'mow', 'mulch', 'weed'\)/);
  assert.match(migration, /dieback_interval_seconds integer not null default 604800/);
  assert.match(migration, /timeClaimsPhysicalCondition', false/);
  assert.match(migration, /observed_condition = 'dead_growth'/);
  assert.match(migration, /Clear dead growth/);
  assert.match(occurrenceMigration, /current_occurrence_id/);
  assert.match(occurrenceMigration, /releaseCapacityBlocked/);
  assert.doesNotMatch(migration, /effort_minutes|estimated_minutes|labor_minutes/i);
});

test("Walkway Cards are visible on canonical object pages", () => {
  const page = read("app/objects/[objectKey]/page.tsx");
  const component = read("components/atlas/walkway-card-panel.tsx");
  const route = read("app/api/atlas/objects/[objectKey]/walkway-card/route.ts");

  assert.match(page, /WalkwayCardPanel/);
  assert.match(component, /Permanent Walkway Card/);
  assert.match(component, /The Clock opens the review/);
  assert.match(component, /Waiting for an open hand slot/);
  assert.match(route, /walkway_cards_v1/);
  assert.doesNotMatch(component, /hours|minutes|time tracking/i);
});
