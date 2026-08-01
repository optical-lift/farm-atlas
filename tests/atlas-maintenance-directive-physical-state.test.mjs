import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const completion = readFileSync(new URL("../supabase/migrations/20260801043200_atlas_maintenance_directives_completion_v1.sql", import.meta.url), "utf8");

test("directive completion evaluates physical result values, not titles", () => {
  assert.match(completion, /p_result_value/);
  assert.doesNotMatch(completion, /directive\.title[^\n]+like|task\.title[^\n]+like/i);
});
