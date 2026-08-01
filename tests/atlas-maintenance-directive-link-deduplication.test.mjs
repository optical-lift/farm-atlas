import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("object and crop links are idempotent", () => {
  assert.match(authoring, /on conflict \(task_id, object_id\) do nothing/);
  assert.match(authoring, /on conflict \(task_id, crop_cycle_id, role\) do update/);
});
