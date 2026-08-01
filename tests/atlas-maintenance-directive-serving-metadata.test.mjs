import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("serving card carries only active directive display metadata", () => {
  assert.match(authoring, /active_maintenance_directive_id/);
  assert.match(authoring, /active_maintenance_directive_title/);
  assert.match(completion, /- 'active_maintenance_directive_id'/);
  assert.match(completion, /not exists \([\s\S]*directive\.status = 'active'/);
});
