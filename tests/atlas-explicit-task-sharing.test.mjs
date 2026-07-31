import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migrationPath = "supabase/migrations/20260731221500_atlas_explicit_task_sharing_authoritative_v1.sql";

test("explicit task membership lists outrank broad farm sharing", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /create or replace function atlas\.can_read_task_for_membership_v1[\s\S]*shared_with_membership_ids[\s\S]*\? membership\.id::text/i,
  );
  assert.match(
    migration,
    /when membership\.role = 'owner' then true[\s\S]*shared_with_membership_ids/i,
  );
  assert.match(
    migration,
    /create or replace function atlas\.home_task_cards_for_membership_v2[\s\S]*shared_with_membership_ids[\s\S]*\? p_membership_id::text/i,
  );
});

test("ordinary and switched day readers remain governed by the same membership predicate", () => {
  const migration = read(migrationPath);

  assert.match(migration, /create or replace function atlas\.can_read_task_for_membership_v1/i);
  assert.match(migration, /create or replace function atlas\.home_task_cards_for_membership_v2/i);
  assert.doesNotMatch(migration, /create or replace function atlas\.home_task_cards_v2/i);
  assert.doesNotMatch(migration, /create or replace function atlas\.owner_operator_home_task_cards_v1/i);
});

test("membership-targeted helpers stay internal and registry-clean", () => {
  const migration = read(migrationPath);

  for (const signature of [
    "can_read_task_for_membership_v1(uuid, uuid)",
    "home_task_cards_for_membership_v2(uuid, uuid, date, date)",
  ]) {
    assert.match(
      migration,
      new RegExp(`revoke all on function atlas\\.${signature.replace(/[()]/g, "\\$&")}[\\s\\S]*from public, anon, authenticated`, "i"),
    );
  }

  assert.match(migration, /authenticated_rpc_registry_drift_v1/);
  assert.match(migration, /set search_path = pg_catalog, atlas/gi);
  assert.doesNotMatch(migration, /update\s+atlas\.tasks/i);
  assert.doesNotMatch(
    migration,
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i,
  );
});

test("migration fails closed on both reviewed function definitions", () => {
  const migration = read(migrationPath);

  assert.match(
    migration,
    /md5\(pg_get_functiondef\([\s\S]*home_task_cards_for_membership_v2\(uuid,uuid,date,date\)/i,
  );
  assert.match(
    migration,
    /md5\(pg_get_functiondef\([\s\S]*can_read_task_for_membership_v1\(uuid,uuid\)/i,
  );
  assert.match(migration, /explicit membership sharing was not installed in both membership readers/i);
});