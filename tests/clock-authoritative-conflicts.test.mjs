import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const foundationPath = "supabase/migrations/20260815153320_clock_capacity_conflicts_v1.sql";
const authorityPath = "supabase/migrations/20260815160125_clock_authoritative_capacity_conflicts_v1.sql";
const foundation = readFileSync(join(root, foundationPath), "utf8");
const migration = readFileSync(join(root, authorityPath), "utf8");

test("Clock capacity foundation preserves the 420 target and 480 maximum boundary", () => {
  assert.match(foundation, /v_target integer := 420/);
  assert.match(foundation, /v_maximum integer := 480/);
  assert.match(foundation, /'status', case when v_over_maximum > 0 then 'conflict' when v_over_target > 0 then 'warning' else 'ok' end/);
  assert.match(foundation, /'hasConflict', v_over_maximum > 0/);
  assert.match(foundation, /'day_capacity_target_exceeded'/);
  assert.match(foundation, /'day_capacity_maximum_exceeded'/);
  assert.match(foundation, /'owner_clock_plan_commit'::text/);
});

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
  assert.doesNotMatch(foundation + migration, /create\s+table/i);
  assert.doesNotMatch(foundation + migration, /create\s+(?:materialized\s+)?view/i);
  assert.doesNotMatch(foundation + migration, /create\s+type/i);
  assert.match(foundation, /clock_day_capacity_state_v1/);
  assert.match(foundation + migration, /worker_day_task_placements/);
});
