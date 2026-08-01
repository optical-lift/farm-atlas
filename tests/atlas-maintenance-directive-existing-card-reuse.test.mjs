import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("existing open Weed Card serving is selected before any serving is created", () => {
  const selectTask = authoring.indexOf("select task.* into v_task");
  const insertTask = authoring.indexOf("insert into atlas.tasks(");
  assert.ok(selectTask >= 0);
  assert.ok(insertTask > selectTask);
  assert.match(authoring, /task\.metadata ->> 'weed_card_id' = v_card_id::text/);
  assert.match(authoring, /task\.status in \('open','blocked'\)/);
});
