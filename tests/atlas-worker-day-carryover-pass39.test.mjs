import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260814200729_worker_day_carryover_snapshot_fast_path.sql");

test("Pass 39 carries from the frozen prior Day snapshot before dynamic reconstruction", () => {
  assert.match(migration, /create or replace function atlas\.member_day_carryover_v1/);
  assert.match(migration, /from atlas\.day_plan_snapshots snapshot/);
  assert.match(migration, /planned_task_ids/);
  assert.match(migration, /snapshot\.service_date=v_previous_work_date/);
  assert.match(migration, /snapshot\.service_date=p_work_date/);
  assert.match(migration, /v_prior_task_ids/);
  assert.match(migration, /v_target_task_ids/);
});

test("Pass 39 retains dynamic Day selection only as a missing-snapshot fallback", () => {
  assert.equal((migration.match(/if not v_snapshot_found then/g) ?? []).length, 2);
  assert.equal((migration.match(/presented_work_selection_rows_v1/g) ?? []).length, 2);
  assert.match(migration, /where p\.presentation_state in \('attention','presented'\)/);
});

test("Pass 39 preserves carryover eligibility and current-day safety contracts", () => {
  assert.match(migration, /if v_previous_work_date>=v_today then return/);
  assert.match(migration, /t\.status in \('open','blocked'\)/);
  assert.match(migration, /coalesce\(t\.commitment_kind,''\)='hard_date'/);
  assert.match(migration, /calendar_commitment_kind/);
  assert.match(migration, /task_sky_presentation_gate_v1/);
  assert.match(migration, /task_capacity_plan_v1/);
  assert.match(migration, /not \(t\.id=any\(coalesce\(v_target_task_ids,array\[\]::uuid\[\]\)\)\)/);
});

test("Pass 39 materializes historical open work before expensive per-task checks", () => {
  assert.match(migration, /prior_open as materialized/);
  assert.match(migration, /with ordinality as item\(task_id,ordinality\)/);
  assert.match(migration, /order by prior\.ordinality,t\.id/);
});

test("Pass 39 keeps the authenticated membership and fixed search-path boundary", () => {
  assert.match(migration, /Active farm membership required/);
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path to 'pg_catalog','atlas','auth'/);
});
