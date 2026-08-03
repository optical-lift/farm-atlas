import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260803015500_atlas_terminal_task_transition_guard.sql", import.meta.url),
  "utf8",
);

test("already-completed tasks return a terminal no-op before farm evidence is written", () => {
  assert.match(migration, /p_transition in \('done', 'checklist_done'\) and v_task\.status = 'done'/);
  assert.match(migration, /'terminalStateNoop', true/);
  assert.match(migration, /'deduplicated', true/);
  const guardPosition = migration.indexOf("p_transition in ('done', 'checklist_done')");
  const legacyCallPosition = migration.indexOf("record_task_transition_v1_internal_legacy(");
  assert.ok(guardPosition >= 0 && legacyCallPosition > guardPosition);
});

test("the guarded internal endpoint remains service-only with a fixed search path", () => {
  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = pg_catalog, atlas/);
  assert.match(migration, /revoke all on function atlas\.record_task_transition_v1_internal[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function atlas\.record_task_transition_v1_internal[\s\S]*to service_role/);
});
