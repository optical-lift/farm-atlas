import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");
const strip = readFileSync(new URL("../components/atlas/maintenance-directive-strip.tsx", import.meta.url), "utf8");

test("directive checklist is persistent and independently checkable", () => {
  assert.match(core, /completed_at timestamptz/);
  assert.match(core, /completed_by_user_id uuid references auth\.users/);
  assert.match(authoring, /set_maintenance_directive_step_v1/);
  assert.match(strip, /type="checkbox"/);
  assert.match(strip, /setAtlasMaintenanceDirectiveStep/);
});
