import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260731222500_atlas_journal_explicit_task_sharing_v1.sql";

test("ordinary Living Day honors explicit membership sharing before legacy scope", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /create or replace function atlas\.can_read_task_in_journal_v1[\s\S]*shared_with_membership_ids/i,
  );
  assert.match(
    migration,
    /not atlas\.is_farm_owner\(task\.farm_id\)[\s\S]*current_membership_id\(task\.farm_id\)[\s\S]*\? membership\.id::text/i,
  );
  assert.match(migration, /else case task\.visibility_scope/i);
});

test("journal visibility keeps its governed authenticated helper boundary", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /revoke all on function atlas\.can_read_task_in_journal_v1\(uuid\)[\s\S]*from public, anon, service_role/i,
  );
  assert.match(
    migration,
    /grant execute on function atlas\.can_read_task_in_journal_v1\(uuid\)[\s\S]*to authenticated/i,
  );
  assert.match(migration, /authenticated_rpc_registry_drift_v1/);
  assert.match(migration, /set search_path = pg_catalog, atlas/i);
});

test("journal sharing migration is fail-closed and data-neutral", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /md5\(pg_get_functiondef\([\s\S]*can_read_task_in_journal_v1\(uuid\)/i,
  );
  assert.doesNotMatch(migration, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(
    migration,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );
});