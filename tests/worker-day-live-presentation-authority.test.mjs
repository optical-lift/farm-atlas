import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(new URL("../supabase/migrations/20260824124033_qualify_worker_day_live_presentation_authority_v1.sql", import.meta.url), "utf8");

test("live Worker Day delegation qualifies presentation state at its source row", () => {
  assert.match(migration, /presented_work_selection_rows_v3\(p_farm_id, p_membership_id, v_work_date\) delegated/);
  assert.match(migration, /where delegated\.presentation_state = ''presented''/);
  assert.doesNotMatch(migration, /\n    where presentation_state = ''presented'';/);
});
