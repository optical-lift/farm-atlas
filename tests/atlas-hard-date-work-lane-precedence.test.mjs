import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260812163419_hard_date_overrides_legacy_discretionary_lane_v1.sql");

test("legacy Owner hard dates cannot be demoted by an old discretionary work-lane marker", () => {
  assert.match(migration, /calendar_commitment_kind',''\)\) = 'owner_hard_date'/);
  assert.match(migration, /date_commitment',''\)\) = 'hard_date'/);

  const hardDateReturn = migration.indexOf("if v_hard_date then return 'required'; end if;");
  const discretionaryReturn = migration.indexOf("if v_explicit = 'discretionary' then return v_explicit; end if;");

  assert.notEqual(hardDateReturn, -1, "hard-date precedence guard is missing");
  assert.notEqual(discretionaryReturn, -1, "explicit discretionary fallback is missing");
  assert.ok(hardDateReturn < discretionaryReturn, "hard-date truth must win before legacy discretionary metadata");
});

test("work-type lanes that carry their own execution semantics remain explicit before hard-date promotion", () => {
  const preservedLaneReturn = migration.indexOf("if v_explicit in ('required','process_continuation','rhythm') then return v_explicit; end if;");
  const hardDateReturn = migration.indexOf("if v_hard_date then return 'required'; end if;");

  assert.notEqual(preservedLaneReturn, -1, "explicit required/process/rhythm preservation is missing");
  assert.ok(preservedLaneReturn < hardDateReturn, "process and rhythm lanes must stay distinct when they already carry the work semantics");
});

test("legacy Owner hard-date task and occurrence rows are reconciled to the same canonical commitment", () => {
  assert.match(migration, /update atlas\.tasks task[\s\S]*calendar_commitment_kind' = 'owner_hard_date'/);
  assert.match(migration, /update atlas\.planned_work_occurrences occurrence/);
  assert.match(migration, /work_lane = 'required'/);
  assert.match(migration, /commitment_kind = 'hard_date'/);
  assert.match(migration, /'date_commitment', 'hard_date'/);
});
