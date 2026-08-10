import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260810205500_project_day_preview_respects_actual_day_boundary.sql");

test("future project-day previews do not inherit unfinished current-day work", () => {
  assert.match(migration, /p_selected_date <> \(now\(\) at time zone 'America\/Chicago'\)::date[\s\S]*coalesce\(p_due_date = p_selected_date, false\)/);
});

test("the actual current day still carries genuine overdue and current-serving project work", () => {
  assert.match(migration, /coalesce\(p_due_date <= p_selected_date, false\)/);
  assert.match(migration, /p_metadata ->> 'current_serving'/);
  assert.match(migration, /p_metadata ->> 'completion_gate_serving'/);
  assert.match(migration, /current_serving_not_backlog_debt/);
});

test("both universal and operator organization feeds use the same day-boundary helper", () => {
  const calls = migration.match(/atlas\.project_task_visible_on_day_v1\(/g) ?? [];
  assert.ok(calls.length >= 3, `expected helper definition plus two feed calls; found ${calls.length}`);
  assert.match(migration, /create or replace function atlas\.owner_operator_organization_home_v1/);
  assert.match(migration, /create or replace function atlas\.universal_home_v1/);
});
