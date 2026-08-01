import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801012200_atlas_dependency_clock_gate_audit_v1.sql", import.meta.url),
  "utf8",
);

test("dependency readiness uses occurrence state while release writes the allowed audit outcome", () => {
  assert.match(migration, /'gate_satisfied'/);
  assert.match(migration, /v_definition := replace\(v_definition, v_fragment, ''\)/);
  assert.match(migration, /v_definition like '%''gate_satisfied''%'/);
  assert.match(migration, /gate_satisfied_at = v_clock\.ready_at/);
  assert.match(migration, /Expected exactly one unsupported dependency gate audit fragment/);
});
