import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const migrationPath = "supabase/migrations/20260815155500_clock_authoritative_capacity_conflicts_v1.sql";
const migration = readFileSync(join(root, migrationPath), "utf8");

test("Clock capacity conflict is exposed separately from compatibility warnings", () => {
  assert.match(migration, /'warnings', v_warnings/);
  assert.match(migration, /'conflicts', v_conflicts/);
  assert.match(migration, /'day_capacity_maximum_exceeded'/);
  assert.match(migration, /v_capacity->>'hasConflict'/);
  assert.match(migration, /coalesce\(v_plan->'conflicts', '\[\]'::jsonb\)/);
});

test("Clock conflict truth is derived from server capacity rather than client warnings", () => {
  const conflictBlock = migration.slice(
    migration.indexOf("-- Conflict truth is server-derived"),
    migration.indexOf("return p_plan || jsonb_build_object"),
  );

  assert.match(conflictBlock, /v_capacity->'warningCodes'/);
  assert.match(conflictBlock, /day_capacity_maximum_exceeded/);
  assert.doesNotMatch(conflictBlock, /p_plan->'warnings'/);
  assert.doesNotMatch(conflictBlock, /p_changes|v_change/);
});

test("Clock Pass 2 preserves authority boundaries and API security", () => {
  assert.doesNotMatch(migration, /insert\s+into\s+atlas\.(?:planned_work_occurrences|task_release_queue_items|production_plans|production_lots)/i);
  assert.doesNotMatch(migration, /update\s+atlas\.(?:planned_work_occurrences|task_release_queue_items|production_plans|production_lots)/i);
  assert.doesNotMatch(migration, /delete\s+from\s+atlas\.(?:planned_work_occurrences|task_release_queue_items|production_plans|production_lots)/i);

  assert.match(migration, /security definer\s+set search_path to 'pg_catalog', 'atlas', 'auth'/i);
  assert.match(migration, /revoke all on function atlas\.owner_commit_worker_clock_plan_api_v2.*from public, anon/is);
  assert.match(migration, /grant execute on function atlas\.owner_commit_worker_clock_plan_api_v2.*to authenticated, service_role/is);
});

test("Clock Pass 2 does not create a parallel scheduler ontology", () => {
  assert.doesNotMatch(migration, /create\s+table/i);
  assert.doesNotMatch(migration, /create\s+(?:materialized\s+)?view/i);
  assert.doesNotMatch(migration, /create\s+type/i);
  assert.match(migration, /clock_day_capacity_state_v1/);
  assert.match(migration, /worker_day_task_placements/);
});
