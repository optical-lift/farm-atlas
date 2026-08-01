import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("directive completion is driven by append-only Weed and Mowing evidence", () => {
  assert.match(completion, /new\.weed_pass_id/);
  assert.match(completion, /new\.condition_after/);
  assert.match(completion, /new\.outcome/);
  assert.match(completion, /new\.completion_percent/);
});
