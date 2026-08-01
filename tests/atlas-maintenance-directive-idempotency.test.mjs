import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");
const authoring = readFileSync(new URL("../supabase/migrations/20260801043100_atlas_maintenance_directives_authoring_v1.sql", import.meta.url), "utf8");

test("manual directive submission is idempotent within a farm", () => {
  assert.match(core, /unique \(farm_id, idempotency_key\)/);
  assert.match(authoring, /v_existing_directive_id/);
  assert.match(authoring, /'deduplicated', true/);
});
