import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const core = readFileSync(new URL("../supabase/migrations/20260801043000_atlas_maintenance_directives_core_v1.sql", import.meta.url), "utf8");

test("temporary directive lifecycle is explicit", () => {
  assert.match(core, /status text not null default 'active' check \(status in \('active','completed','cancelled'\)\)/);
});
