import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812154000_enable_rls_on_unprivileged_atlas_tables_v1.sql", import.meta.url),
  "utf8",
);

const protectedTables = [
  "task_completion_impact_policies",
  "postharvest_containers",
  "production_harvest_lots",
  "production_harvest_stand_entries",
  "production_harvest_container_assignments",
  "postharvest_container_events",
  "production_postharvest_gates",
  "production_harvest_lot_tasks",
  "goals",
  "goal_requirements",
  "goal_evaluations",
  "goal_transitions",
  "goal_task_links",
  "task_prerequisites",
  "owner_week_projection",
  "project_relationships",
];

test("release hardening enables RLS on the complete verified Atlas table set", () => {
  for (const table of protectedTables) {
    assert.match(migration, new RegExp(`'${table}'`));
  }

  assert.match(migration, /alter table atlas\.%I enable row level security/i);
  assert.match(migration, /has_table_privilege\('anon'/);
  assert.match(migration, /has_table_privilege\('authenticated'/);
  assert.match(migration, /service_role/);
  assert.match(migration, /postgres/);
});

test("release hardening does not invent a direct client access policy", () => {
  assert.doesNotMatch(migration, /create\s+policy/i);
  assert.doesNotMatch(migration, /grant\s+(select|insert|update|delete)/i);
});
