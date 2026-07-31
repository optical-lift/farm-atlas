import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read(
  "supabase/migrations/20260731183700_atlas_lock_rpc_execution_boundary_v1.sql",
);

test("Atlas removes implicit anonymous execution while preserving existing signed-in contracts", () => {
  assert.match(migration, /has_function_privilege\('authenticated'/);
  assert.match(migration, /has_function_privilege\('service_role'/);
  assert.match(migration, /grant execute on function %s to authenticated/);
  assert.match(migration, /grant execute on function %s to service_role/);
  assert.match(migration, /revoke execute on function %s from public, anon/);

  for (const line of migration.split("\n")) {
    assert.doesNotMatch(
      line,
      /^\s*grant execute\b.*\bto\s+(?:anon|public)\b/i,
    );
  }
});

test("future Atlas routines are fail-closed instead of inheriting PUBLIC execute", () => {
  assert.match(
    migration,
    /alter default privileges for role postgres in schema atlas[\s\S]*revoke execute on functions from public/,
  );
  assert.match(migration, /anonymous_routine_count <> 0/);
});

test("the migration enforces fixed SECURITY DEFINER search paths", () => {
  assert.match(migration, /p\.prosecdef/);
  assert.match(migration, /setting like 'search_path=%'/);
  assert.match(migration, /unsafe_definer_count <> 0/);
});

test("web-push dispatcher secrets stay service-role-only", () => {
  assert.match(migration, /atlas\.web_push_dispatch_config_v1\(text\)/);
  assert.match(
    migration,
    /atlas\.claim_notification_delivery_batch_v1\(integer,integer\)/,
  );
  assert.match(
    migration,
    /atlas\.record_notification_delivery_result_v1\(uuid,boolean,integer,text,boolean,boolean\)/,
  );
  assert.match(
    migration,
    /Web-push dispatcher configuration escaped its service-role boundary/,
  );
  assert.match(migration, /Web-push service-role execution was not preserved/);
});

test("the authenticated universal home remains inside the supported RPC surface", () => {
  assert.match(migration, /atlas\.universal_home_v1\(uuid,uuid,date,date\)/);
  assert.match(migration, /Authenticated Atlas home execution was not preserved/);
});
