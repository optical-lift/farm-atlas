import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260813022500_worker_day_cue_dismiss_v1.sql", import.meta.url), "utf8");

test("only the cue's assigned membership can persist dismissal", () => {
  assert.match(migration, /fm\.id=cue\.membership_id/);
  assert.match(migration, /fm\.user_id=auth\.uid\(\)/);
  assert.doesNotMatch(migration, /role='owner'/);
});
