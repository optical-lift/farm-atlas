import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("maintenance directives use the daily lockscreen delivery plan", () => {
  for (const window of ["first_thing", "morning", "midday", "afternoon", "evening"]) {
    assert.match(core, new RegExp(`when '${window}'`));
  }
  assert.match(authoring, /insert into atlas\.task_notification_plans/);
  assert.match(authoring, /group_key/);
  assert.match(authoring, /maintenance_directive/);
  assert.match(authoring, /on conflict \(task_id\) do update/);
});
