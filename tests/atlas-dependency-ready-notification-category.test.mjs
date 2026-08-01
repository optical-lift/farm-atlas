import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260801012210_atlas_dependency_ready_notification_category_v1.sql", import.meta.url),
  "utf8",
);

test("dependency readiness has its own actionable push category", () => {
  assert.match(migration, /'dependency_ready'::text/);
  assert.match(migration, /"dependency_ready": true/);
  assert.match(migration, /actionable Work handoff/);
  assert.match(migration, /it is not Bell history/);
  assert.match(migration, /dependency_ready notification category postcondition failed/);
});
