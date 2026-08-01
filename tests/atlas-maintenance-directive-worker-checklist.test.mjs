import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("worker checklist access is scoped to the directive assignee", () => {
  assert.match(authoring, /v_membership_id <> v_directive\.assigned_membership_id/);
  assert.match(authoring, /v_role not in \('owner','manager'\)/);
});
