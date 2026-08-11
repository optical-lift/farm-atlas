import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812003000_worker_day_prerequisite_order_v1.sql", import.meta.url),
  "utf8",
);

const normalized = migration.replace(/\s+/g, " ").trim();

test("farm-hand Day holds downstream work while a canonical prerequisite is incomplete", () => {
  assert.match(normalized, /when v_target_role='farm_hand' and dependency\.waiting then 'held'/);
  assert.match(normalized, /when v_target_role='farm_hand' and dependency\.waiting then 'waiting_on_prerequisite'/);
  assert.match(normalized, /prerequisite\.downstream_task_id=task\.id and prerequisite\.active=true and prerequisite\.satisfied_at is null/);
  assert.match(normalized, /prerequisite_task\.status is distinct from prerequisite\.required_status/);
});

test("prerequisite waiting does not count as worker overload", () => {
  assert.match(normalized, /when v_target_role='farm_hand' and dependency\.waiting then false/);
});

test("farm-hand Sunday override enforces the same prerequisite boundary", () => {
  const prerequisiteReferences = migration.match(/atlas\.task_prerequisites/g) ?? [];
  assert.ok(prerequisiteReferences.length >= 2, "normal and Sunday worker paths must both read canonical prerequisites");
  assert.match(migration, /owner_sunday_override/);
});

test("Owner and manager presentation are not collapsed into the worker prerequisite rule", () => {
  assert.match(migration, /v_target_role='farm_hand' and dependency\.waiting/);
  assert.doesNotMatch(migration, /v_target_role in \('owner','manager','farm_hand'\) and dependency\.waiting/);
});

test("the policy is generic and does not special-case the bouquet-bar specimen", () => {
  assert.doesNotMatch(migration, /Karianne/i);
  assert.doesNotMatch(migration, /bloom bar/i);
  assert.doesNotMatch(migration, /bouquet/i);
  assert.doesNotMatch(migration, /07459067-d85e-478d-b9af-c1847076ee70/i);
});

test("the existing authenticated presentation function keeps its privilege surface", () => {
  assert.match(migration, /create or replace function atlas\.presented_work_rows_v1/);
  assert.match(migration, /security definer/);
  assert.doesNotMatch(migration, /\bgrant\s+execute\b/i);
  assert.doesNotMatch(migration, /\brevoke\s+all\s+on\s+function\b/i);
});
