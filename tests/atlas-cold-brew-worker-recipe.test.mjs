import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260813023000_restore_worker_execution_facts_v1.sql", import.meta.url), "utf8");

test("cold brew worker packet retains tonight and tomorrow recipe steps", () => {
  assert.match(migration, /half-gallon wide-mouth mason jar/);
  assert.match(migration, /refrigerate 12–16 hours/);
  assert.match(migration, /Tomorrow strain through a fine-mesh strainer lined with a coffee filter/);
  assert.match(migration, /Serve strong over plenty of ice with water or milk to taste/);
});
