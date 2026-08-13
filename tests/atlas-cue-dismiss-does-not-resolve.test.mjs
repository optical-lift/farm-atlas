import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260813022500_worker_day_cue_dismiss_v1.sql", import.meta.url), "utf8");

test("dismissal records dismissed without manufacturing a resolved result", () => {
  assert.match(migration, /set status='dismissed'/);
  assert.doesNotMatch(migration, /set response=/);
  assert.doesNotMatch(migration, /resolved_at=now\(\)/);
});
