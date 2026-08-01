import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801034500_atlas_sunday_guardrail_employees_only_v1.sql", import.meta.url),
  "utf8",
);

test("Sunday guardrail applies only to farm-hand assignments", () => {
  assert.match(migration, /v_assigned_role is distinct from 'farm_hand'/);
  assert.match(migration, /when 'owner' then 'owner'/);
  assert.match(migration, /when 'marshall' then 'manager'/);
  assert.match(migration, /when 'anna' then 'farm_hand'/);
  assert.match(migration, /Owner and manager tasks may be scheduled on Sunday without an override/);
});

test("explicit Sunday employee work remains supported", () => {
  assert.match(
    migration,
    /coalesce\(\(new\.metadata ->> 'allow_sunday'\)::boolean, false\) is true/,
  );
  assert.match(migration, /new\.due_date := new\.due_date \+ 1/);
  assert.match(migration, /Elm Farm employee work does not schedule regular Sunday work/);
});

test("owner and manager exemption clears stale active guardrail markers", () => {
  for (const key of [
    "sunday_guardrail_applied",
    "sunday_guardrail_original_due_date",
    "sunday_guardrail_shifted_to",
    "sunday_guardrail_applied_at",
    "sunday_guardrail_reason",
  ]) {
    assert.match(migration, new RegExp(`- '${key}'`));
  }

  assert.match(migration, /sunday_guardrail_exempt_role/);
  assert.match(migration, /Sunday guardrail applies only to employee-assigned work/);
});

test("trigger function remains internal and uses a fixed search path", () => {
  assert.match(migration, /set search_path = pg_catalog, atlas/);
  assert.match(migration, /revoke all on function atlas\.enforce_no_sunday_task_due_date\(\) from public, anon, authenticated/);
  assert.match(migration, /grant execute on function atlas\.enforce_no_sunday_task_due_date\(\) to service_role/);
  assert.match(migration, /Employee-only Sunday guardrail postcondition failed/);
});
