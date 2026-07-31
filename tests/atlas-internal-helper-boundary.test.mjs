import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260731191000_atlas_narrow_internal_security_definer_helpers_v1.sql",
);
const sqlLines = migration.split(/\r?\n/).map((line) => line.trim());

const reviewedHelpers = [
  "assert_production_seed_ready_v1",
  "bell_badge_count_for_user_v1",
  "refresh_object_active_task_count_v1",
  "resolve_effective_rhythm_rule_for_clock_v2",
  "sync_production_care_policies_v1",
  "sync_seed_inventory_dependency_tasks_v1",
];

test("only the six reviewed implementation helpers are narrowed", () => {
  for (const helper of reviewedHelpers) {
    assert.match(migration, new RegExp(`atlas\\.${helper}\\(`));
  }

  for (const intentionallyDeferred of [
    "journal_day_v1",
    "home_task_cards_v2",
    "owner_operator_home_task_cards_v1",
    "tending_gates_v1",
    "project_trail_context_v2",
  ]) {
    const executableSignature = new RegExp(`['\"]atlas\\.${intentionallyDeferred}\\(`);
    assert.doesNotMatch(migration, executableSignature);
  }
});

test("the migration fails closed unless every helper stays behind privileged callers", () => {
  assert.match(migration, /caller_count = 0/);
  assert.match(migration, /not caller\.prosecdef/);
  assert.match(migration, /unsafe_caller_count <> 0/);
  assert.match(migration, /no longer has a reviewed internal caller/);
  assert.match(migration, /not SECURITY DEFINER/);
});

test("RLS policy dependencies prevent helper narrowing", () => {
  assert.match(migration, /from pg_policies policy/);
  assert.match(migration, /policy_reference_count <> 0/);
  assert.match(migration, /referenced by % RLS policy expression/);
});

test("authenticated access is removed without weakening infrastructure access", () => {
  assert.match(
    migration,
    /revoke execute on function %s from authenticated/,
  );
  assert.match(migration, /has_function_privilege\('anon'/);
  assert.match(migration, /has_function_privilege\('service_role'/);
  assert.match(migration, /lost service-role execution during narrowing/);

  assert.equal(
    sqlLines.some((line) => /^grant\s+execute\b/i.test(line)),
    false,
  );
});

test("the boundary migration changes grants, not function implementations", () => {
  assert.doesNotMatch(migration, /create\s+or\s+replace\s+function/i);
  assert.doesNotMatch(migration, /alter\s+function[\s\S]*security\s+(definer|invoker)/i);
});
