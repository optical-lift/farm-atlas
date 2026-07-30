import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260730130000_farmwide_weed_card_clock_enrollment_v1.sql",
);
const contract = read("lib/atlas/weed-card-clock-contract.ts");

test("every still-active permanent Weed Card can enter the Rulebook Clock", () => {
  assert.match(migration, /from atlas\.weed_cards wc/);
  assert.match(migration, /join atlas\.maintenance_objects mo/);
  assert.match(migration, /mo\.active/);
  assert.match(migration, /mo\.maintenance_type = 'weed'/);
  assert.match(migration, /not exists \([\s\S]*existing\.rhythm_key = 'weed_stewardship'/);
  assert.match(migration, /'elm_farmwide_weed_cards_v1'/);
});

test("existing card intervals and completion memory remain authoritative", () => {
  assert.match(migration, /normal_return_interval_days \* 86400/);
  assert.match(migration, /sourceIntervalField', 'maintenance_objects\.normal_return_interval_days'/);
  assert.match(migration, /mo\.last_completed_at is not null/);
  assert.match(migration, /r\.last_completed_at/);
  assert.match(migration, /owner_approved_existing_completion/);
  assert.match(migration, /usesMigrationTimeAsSatisfaction', false/);
});

test("pilot timing profiles expand without inventing physical weed condition", () => {
  assert.match(migration, /then 604800 else 259200/);
  assert.match(migration, /then 604800[\s\S]*else 172800/);
  assert.match(migration, /physicalConditionClaim', 'unknown_until_observed'/);
  assert.match(migration, /physicalConditionAuthority', 'observation_only'/);
  assert.match(migration, /'inferredFromClock', false/);
  assert.match(contract, /inferredFromClock: false/);
});

test("full work renews, partial work recovers, and inspection is bounded", () => {
  assert.match(migration, /weed:fully_completed/);
  assert.match(migration, /weed:partially_completed/);
  assert.match(migration, /weed_inspection_acceptable/);
  assert.match(migration, /'effect', 'full'/);
  assert.match(migration, /'effect', 'partial'/);
  assert.match(migration, /'effect', 'conditional'/);
});

test("Clock work stays canonical and legacy recurrence retires", () => {
  assert.match(migration, /evaluate_rhythm_binding_v1/);
  assert.match(migration, /set active = false/);
  assert.match(migration, /Permanent Weed Card moved to Owner-authored Rulebook and Clock/);
  assert.match(migration, /currentOccurrenceId/);
  assert.doesNotMatch(migration, /insert into atlas\.(bell|push|notification)/i);
});

test("labor effort remains useful but never governs the Clock", () => {
  assert.match(migration, /'usesLaborTime', false/);
  assert.match(migration, /'laborTimeGovernsClock', false/);
  assert.match(contract, /laborTimeGovernsClock: false/);
  assert.doesNotMatch(migration, /total_minutes.*due_at|minutes.*failure_at/i);
});

test("the prepared Weed Card Clock reader explains rule and evidence separately", () => {
  assert.match(migration, /create or replace function atlas\.weed_card_clock_v1/);
  assert.match(migration, /latest_qualifying_satisfaction_plus_existing_weed_card_interval/);
  assert.match(migration, /legacyGenericRecurrenceActive/);
  assert.match(migration, /grant execute on function atlas\.weed_card_clock_v1/);
  assert.match(contract, /contractVersion: "weed_card_clock_v1"/);
  assert.match(contract, /state\?: AtlasRhythmClockState/);
});
