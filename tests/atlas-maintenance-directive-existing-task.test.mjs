import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("existing card serving keeps its task identity when brought forward", () => {
  assert.match(authoring, /update atlas\.tasks\s+set due_date = least/);
  assert.match(authoring, /where id = v_task\.id\s+returning \* into v_task/);
});
