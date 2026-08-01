import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("maintenance directive tables are service-internal behind RPCs", () => {
  for (const table of ["maintenance_directives", "maintenance_directive_steps", "maintenance_directive_crop_cycles"]) {
    assert.match(core, new RegExp(`alter table atlas\\.${table} enable row level security`));
    assert.match(core, new RegExp(`revoke all on table atlas\\.${table} from public, anon, authenticated`));
    assert.match(core, new RegExp(`grant select, insert, update, delete on table atlas\\.${table} to service_role`));
  }
});
