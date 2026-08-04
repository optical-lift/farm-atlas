import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260804002500_bell_history_v3_allows_baseline_write.sql");

test("Bell history v3 remains volatile because its v2 reader establishes the monitoring baseline", () => {
  assert.match(
    migration,
    /alter function atlas\.bell_history_v3\(uuid, uuid, integer, timestamptz\) volatile;/,
  );
  assert.doesNotMatch(migration, /bell_history_v3[\s\S]*\bstable\b/i);
});
