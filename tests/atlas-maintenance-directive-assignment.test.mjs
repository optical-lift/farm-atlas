import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("directive assignee must be active in the same farm", () => {
  assert.match(authoring, /membership\.id = p_assigned_membership_id/);
  assert.match(authoring, /membership\.farm_id = p_farm_id/);
  assert.match(authoring, /membership\.active/);
});
