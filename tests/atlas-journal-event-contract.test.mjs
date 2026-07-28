import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260729040000_journal_event_contract_v1.sql";

test("Journal is a provenance-preserving read index rather than a second truth", () => {
  const migration = read(migrationPath);

  assert.match(migration, /create table if not exists atlas\.journal_event_index/);
  assert.match(migration, /source_workflow_event_id uuid unique references atlas\.workflow_events/);
  assert.match(migration, /unique \(farm_id, event_key\)/);
  assert.match(migration, /provenance jsonb not null/);
  assert.match(migration, /Canonical task, result, state, Trail, and Clock records remain authoritative/);
  assert.doesNotMatch(migration, /update atlas\.tasks[\s\S]*set status/);
  assert.doesNotMatch(migration, /update atlas\.object_state/);
});

test("workflow events enter the Journal once through an idempotent adapter", () => {
  const migration = read(migrationPath);

  assert.match(migration, /create or replace function atlas\.index_workflow_event_v1/);
  assert.match(migration, /on conflict \(farm_id, event_key\) do update/);
  assert.match(migration, /'workflow:' \|\| v_workflow\.event_key/);
  assert.match(migration, /workflow_events_journal_index_v1/);
  assert.match(migration, /after insert or update of source_event, event_date, payload/);
  assert.match(migration, /canonical_source_kind/);
  assert.match(migration, /canonical_source_id/);
  assert.match(migration, /canonical_source_event/);
});

test("prepared Day contract contains carried work, planned work, events, unlocks, and summary", () => {
  const migration = read(migrationPath);
  const contract = read("lib/atlas/journal-contract.ts");

  assert.match(migration, /create or replace function atlas\.journal_day_v1/);
  assert.match(migration, /'contractVersion', 'journal_day_v1'/);
  assert.match(migration, /'carried', v_carried/);
  assert.match(migration, /'planned', v_planned/);
  assert.match(migration, /'events', v_events/);
  assert.match(migration, /'unlocks', v_unlocks/);
  assert.match(migration, /'summary', jsonb_build_object/);
  assert.match(contract, /export type AtlasJournalDay/);
  assert.match(contract, /contractVersion: "journal_day_v1"/);
});

test("Journal reads remain role scoped and clients cannot manufacture history", () => {
  const migration = read(migrationPath);

  assert.match(migration, /alter table atlas\.journal_event_index enable row level security/);
  assert.match(migration, /atlas\.can_read_journal_event_v1\(id\)/);
  assert.match(migration, /atlas\.is_farm_owner/);
  assert.match(migration, /atlas\.is_farm_manager_or_owner/);
  assert.match(migration, /atlas\.can_read_project/);
  assert.match(migration, /revoke insert, update, delete, truncate, references, trigger/);
  assert.match(migration, /revoke all on function atlas\.upsert_journal_event_v1[\s\S]*authenticated/);
});

test("Build 1 does not alter current visual surfaces or CSS", () => {
  const packageJson = read("package.json");
  const migration = read(migrationPath);
  const contract = read("lib/atlas/journal-contract.ts");

  assert.match(packageJson, /"prebuild": "npm test"/);
  assert.doesNotMatch(migration, /\.css|className|style=/);
  assert.doesNotMatch(contract, /\.css|className|style=/);
});
