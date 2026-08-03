import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260803143600_atlas_home_day_presented_work.sql",
  import.meta.url,
);

test("operator Home day uses the same Presented Work journal as Day", async () => {
  const sql = await readFile(migrationPath, "utf8");

  assert.match(sql, /create or replace function atlas\.home_day_for_membership_v1/i);
  assert.match(sql, /atlas\.journal_day_for_membership_v1\s*\(/i);
  assert.match(sql, /'presentationContract'/i, "the journal carries the Presented Work contract");
  assert.doesNotMatch(
    sql,
    /from\s+atlas\.tasks\s+task[\s\S]*task\.due_date\s*=\s*v_day/i,
    "Home must not rebuild a raw due-date plan that can bypass member availability",
  );
});
