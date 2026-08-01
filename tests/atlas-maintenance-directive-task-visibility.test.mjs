import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("task card instructions inherit canonical task visibility", () => {
  assert.match(core, /can_read_task_in_journal_v1\(p_task_id\)/);
  assert.match(core, /serving_task_id = p_task_id or directive\.prerequisite_task_id = p_task_id/);
});
