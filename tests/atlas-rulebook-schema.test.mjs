import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260729050000_rulebook_schema_v1.sql";

test("Rulebook rules are versioned instead of silently overwritten", () => {
  const migration = read(migrationPath);

  assert.match(migration, /create table if not exists atlas\.rhythm_rules/);
  assert.match(migration, /rule_key text not null/);
  assert.match(migration, /version integer not null/);
  assert.match(migration, /unique \(farm_id, rule_key, version\)/);
  assert.match(migration, /supersedes_rule_id uuid references atlas\.rhythm_rules/);
  assert.match(migration, /create_rhythm_rule_version_v1/);
  assert.match(migration, /status = 'superseded'/);
});

test("Rulebook stores the complete owner-authored rhythm grammar", () => {
  const migration = read(migrationPath);

  assert.match(migration, /applicability jsonb not null/);
  assert.match(migration, /validity_interval_seconds integer not null/);
  assert.match(migration, /warning_window_seconds integer not null/);
  assert.match(migration, /grace_window_seconds integer not null/);
  assert.match(migration, /qualifying_touches jsonb not null/);
  assert.match(migration, /failure_consequence jsonb not null/);
  assert.match(migration, /player_routing jsonb not null/);
  assert.match(migration, /owner_reason text/);
});

test("inheritance order is fixed and nearest active explicit rule wins", () => {
  const migration = read(migrationPath);
  const contract = read("lib/atlas/rulebook-contract.ts");

  const expectedOrder = [
    "farm_default",
    "object_class",
    "zone_modifier",
    "contents_stage",
    "subject_override",
    "temporary_exception",
  ];

  for (const layer of expectedOrder) {
    assert.match(migration, new RegExp(`'${layer}'`));
    assert.match(contract, new RegExp(`"${layer}"`));
  }

  assert.match(migration, /when 'temporary_exception' then 600/);
  assert.match(migration, /when 'subject_override' then 500/);
  assert.match(migration, /when 'contents_stage' then 400/);
  assert.match(migration, /when 'zone_modifier' then 300/);
  assert.match(migration, /when 'object_class' then 200/);
  assert.match(migration, /when 'farm_default' then 100/);
  assert.match(migration, /nearest_active_explicit_rule_wins/);
  assert.match(migration, /order by c\.layer_rank desc, c\.priority desc, c\.version desc/);
});

test("a resolved subject can explain which rule applies and why", () => {
  const migration = read(migrationPath);
  const contract = read("lib/atlas/rulebook-contract.ts");

  assert.match(migration, /create or replace function atlas\.resolve_effective_rhythm_rule_v1/);
  assert.match(migration, /'effectiveRule', v_winner/);
  assert.match(migration, /'candidateCount', v_candidate_count/);
  assert.match(migration, /'winnerLayer'/);
  assert.match(migration, /'matchedOn'/);
  assert.match(migration, /'inheritanceOrder'/);
  assert.match(migration, /'noMatch', v_winner is null/);
  assert.match(contract, /export type AtlasEffectiveRhythmResolution/);
  assert.match(contract, /contractVersion: "effective_rhythm_rule_v1"/);
});

test("Rulebook configuration is owner-governed and role-safe", () => {
  const migration = read(migrationPath);

  assert.match(migration, /alter table atlas\.rhythm_rules enable row level security/);
  assert.match(migration, /alter table atlas\.rhythm_bindings enable row level security/);
  assert.match(migration, /rhythm_rules_owner_read/);
  assert.match(migration, /rhythm_bindings_owner_read/);
  assert.match(migration, /Only a farm Owner may author Rulebook versions/);
  assert.match(migration, /Only a farm Owner may bind Rulebook versions/);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger/);
  assert.match(migration, /Farm membership is required to resolve a Rulebook rhythm/);
  assert.match(migration, /revoke all on function atlas\.resolve_effective_rhythm_rule_v1[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function atlas\.resolve_effective_rhythm_rule_v1[\s\S]*to authenticated/);
});

test("Build 2 does not guess live Elm rhythm values or alter visual files", () => {
  const migration = read(migrationPath);
  const contract = read("lib/atlas/rulebook-contract.ts");

  assert.doesNotMatch(migration, /insert into atlas\.rhythm_rules/i);
  assert.doesNotMatch(migration, /Field Rows|Redbud Island|Elm Farm/);
  assert.doesNotMatch(migration, /\.css|className|style=/);
  assert.doesNotMatch(contract, /\.css|className|style=/);
});
