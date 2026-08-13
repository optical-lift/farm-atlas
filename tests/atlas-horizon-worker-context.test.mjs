import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260813023100_restore_horizon_worker_context_v1.sql", import.meta.url), "utf8");

test("Horizon keeps the useful crop and timing facts on the worker surface", () => {
  assert.match(migration, /ProCut Horizon · BW7 \+ BW8/);
  assert.match(migration, /Projected germination · Aug 16–Aug 22/);
  assert.match(migration, /Projected harvest · Oct 1–Oct 11/);
  assert.match(migration, /Projected clear bed · Oct 16/);
  assert.match(migration, /Germination watch begins from the recorded sow date/);
});
