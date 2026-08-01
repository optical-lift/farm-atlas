import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("temporary directive points at its canonical serving task", () => {
  assert.match(core, /serving_task_id uuid references atlas\.tasks/);
  assert.match(core, /prerequisite_task_id uuid references atlas\.tasks/);
});
