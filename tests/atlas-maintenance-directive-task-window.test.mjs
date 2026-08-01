import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("bringing a persistent card forward updates the existing notification plan", () => {
  assert.match(migration, /on conflict \(task_id\) do update/);
  assert.match(migration, /release_local_time = excluded\.release_local_time/);
  assert.match(migration, /close_local_time = excluded\.close_local_time/);
});
