import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("only owner and manager can author or cancel maintenance directives", () => {
  assert.match(authoring, /v_role not in \('owner','manager'\)/);
  assert.match(authoring, /Only an Owner or manager may add maintenance work/);
  assert.match(authoring, /Only an Owner or manager may cancel maintenance work/);
});

test("assigned worker may update only their own directive checklist", () => {
  assert.match(authoring, /v_membership_id <> v_directive\.assigned_membership_id/);
  assert.match(authoring, /This checklist belongs to another player/);
});

test("public and anon execution remain absent", () => {
  assert.match(completion, /revoke all on function atlas\.create_object_maintenance_directive_v1[^\n]+from public, anon/);
  assert.match(completion, /revoke all on function atlas\.set_maintenance_directive_step_v1[^\n]+from public, anon/);
  assert.doesNotMatch(completion, /grant execute[^\n]+to anon/i);
});
