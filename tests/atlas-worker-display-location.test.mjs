import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811234500_fill_worker_display_location_v1.sql", import.meta.url),
  "utf8",
);

test("assigned worker work fills a missing display location from canonical place metadata", () => {
  assert.match(migration, /new\.visibility_scope<>'assigned_worker'/);
  assert.match(migration, /new\.assigned_membership_id is null/);
  assert.match(migration, /new\.metadata->>'display_location'/);
  assert.match(migration, /new\.metadata->>'location_name'/);
  assert.match(migration, /new\.metadata->>'departure_label'/);
  assert.match(migration, /new\.metadata->>'address'/);
});

test("location_name remains the preferred human label while address truth is preserved separately", () => {
  const locationIndex = migration.indexOf("new.metadata->>'location_name'");
  const departureIndex = migration.indexOf("new.metadata->>'departure_label'", locationIndex);
  const addressIndex = migration.indexOf("new.metadata->>'address'", departureIndex);
  assert.ok(locationIndex >= 0);
  assert.ok(departureIndex > locationIndex);
  assert.ok(addressIndex > departureIndex);
  assert.match(migration, /display_location_source/);
  assert.doesNotMatch(migration, /metadata\s*=\s*jsonb_build_object\(/);
});

test("existing active assigned worker tasks are reconciled generically", () => {
  assert.match(migration, /update atlas\.tasks task/);
  assert.match(migration, /task\.status in \('open','blocked'\)/);
  assert.match(migration, /task\.visibility_scope='assigned_worker'/);
  assert.match(migration, /task\.assigned_membership_id is not null/);
  assert.doesNotMatch(migration, /07459067-d85e-478d-b9af-c1847076ee70/);
  assert.doesNotMatch(migration, /f710c9c3-6e08-48ab-8a28-e00caf78a9b2/);
});

test("future task writes maintain the worker location invariant", () => {
  assert.match(migration, /create trigger fill_worker_display_location_v1/);
  assert.match(migration, /before insert or update of metadata,visibility_scope,assigned_membership_id/);
  assert.match(migration, /on atlas\.tasks/);
});
