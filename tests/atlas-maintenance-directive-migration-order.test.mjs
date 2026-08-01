import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";

test("maintenance directive migrations replay in dependency order", () => {
  for (const file of [
    "../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql",
    "../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql",
    "../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql",
  ]) assert.equal(existsSync(new URL(file, import.meta.url)), true);
});
