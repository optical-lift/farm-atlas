import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("directive staging writes one notification plan per serving task", () => {
  assert.match(authoring, /task_notification_plans_task_id/);
  assert.match(authoring, /on conflict \(task_id\) do update/);
});
