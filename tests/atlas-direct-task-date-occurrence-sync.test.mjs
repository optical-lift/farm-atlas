import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812000500_direct_task_date_occurrence_sync_v1.sql", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();

test("direct active task date edits synchronize the linked released occurrence", () => {
  assert.match(migration, /create or replace function atlas\.sync_active_task_due_date_occurrence_v1/);
  assert.match(migration, /after update of due_date on atlas\.tasks/);
  assert.match(migration, /old\.due_date is distinct from new\.due_date/);
  assert.match(normalized, /occurrence\.released_task_id=new\.id and occurrence\.state='released'/);
  assert.match(migration, /planned_due_date=new\.due_date/);
});

test("independent not-before gates and historical provenance are preserved", () => {
  assert.match(migration, /occurrence\.not_before_date=occurrence\.planned_due_date/);
  assert.match(migration, /occurrence\.not_before_date=old\.due_date/);
  assert.match(migration, /planned_occurrence_date_role',''\)='historical_release_provenance'/);
  assert.match(migration, /occurrence\.metadata->>'historical_release_provenance'/);
});

test("the confirmed Home Depot correction uses stable identity and fails closed on drift", () => {
  assert.match(migration, /farm\.stable_key='elm_farm'/);
  assert.match(migration, /task\.metadata->>'task_key'='anna_20260807_home_depot_curbside_pickup'/);
  assert.match(migration, /v_task\.due_date is distinct from date '2026-08-13'/);
  assert.match(migration, /explicit_owner_schedule_move/);
  assert.doesNotMatch(migration, /a8489224-31a0-44f3-9d29-c3a8388c0d96/);
  assert.doesNotMatch(migration, /84e68dc9-dac9-4d72-9f1c-77952913c00e/);
});

test("the correction does not mass-reconcile ambiguous active mismatches", () => {
  assert.doesNotMatch(migration, /update atlas\.planned_work_occurrences[\s\S]*from atlas\.tasks task[\s\S]*where task\.status in \('open','blocked'\)/);
  assert.doesNotMatch(migration, /Reimburse Melody/);
  assert.doesNotMatch(migration, /Add new card \+ update Elm bills/);
});
