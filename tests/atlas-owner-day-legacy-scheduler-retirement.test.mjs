import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811230500_retire_legacy_owner_day_schedule_v1.sql", import.meta.url),
  "utf8",
);
const currentPlacementMigration = readFileSync(
  new URL("../supabase/migrations/20260811225500_owner_day_floating_work_placement_v1.sql", import.meta.url),
  "utf8",
);

test("legacy v1 scheduler delegates to the canonical v2 implementation instead of carrying its old mutation engine", () => {
  const v1Start = migration.indexOf("create or replace function atlas.owner_build_worker_day_schedule_v1");
  const apiStart = migration.indexOf("create or replace function atlas.owner_build_worker_day_schedule_api_v1");
  const v1Body = migration.slice(v1Start, apiStart);
  assert.ok(v1Start >= 0);
  assert.ok(apiStart > v1Start);
  assert.match(v1Body, /owner_build_worker_day_schedule_v2/);
  assert.doesNotMatch(v1Body, /set\s+due_date\s*=\s*p_day/i);
  assert.doesNotMatch(v1Body, /update\s+atlas\.tasks/i);
  assert.match(v1Body, /revoke all on function atlas\.owner_build_worker_day_schedule_v1\(uuid,uuid,date,jsonb\) from public,anon,authenticated,service_role/);
  assert.doesNotMatch(v1Body, /grant execute on function atlas\.owner_build_worker_day_schedule_v1/);
});

test("legacy authenticated API now uses the same Owner-only boundary as current Day editing", () => {
  assert.match(migration, /create or replace function atlas\.owner_build_worker_day_schedule_api_v1/);
  assert.match(migration, /fm\.role='owner'/);
  assert.doesNotMatch(migration, /fm\.role in \('owner','manager'\)/);
  assert.match(migration, /owner_build_worker_day_schedule_v2/);
  assert.match(migration, /revoke all on function atlas\.owner_build_worker_day_schedule_api_v1\(uuid,uuid,date,jsonb\) from public,anon,service_role/);
  assert.match(migration, /grant execute on function atlas\.owner_build_worker_day_schedule_api_v1\(uuid,uuid,date,jsonb\) to authenticated/);
});

test("current and compatibility authenticated scheduler entry points are registered with canonical RPC registry fields", () => {
  assert.match(migration, /atlas\.owner_build_worker_day_schedule_api_v1\(uuid, uuid, date, jsonb\)/);
  assert.match(migration, /atlas\.owner_build_worker_day_schedule_api_v2\(uuid, uuid, date, jsonb\)/);
  assert.match(migration, /classification,/);
  assert.match(migration, /authenticated_execute_expected,/);
  assert.match(migration, /security_definer_expected,/);
  assert.match(migration, /service_execute_expected,/);
  assert.doesNotMatch(migration, /\bwrite_kind\b/);
  assert.doesNotMatch(migration, /\broute_dependencies\b/);
});

test("the delegated v2 scheduler uses Day placement for existing floating tasks", () => {
  assert.match(currentPlacementMigration, /owner_apply_worker_day_edits_api_v1/);
  assert.match(currentPlacementMigration, /'kind','place'/);
  assert.doesNotMatch(currentPlacementMigration, /set\s+due_date\s*=\s*p_day/i);
});
