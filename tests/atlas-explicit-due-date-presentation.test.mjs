import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260804071300_present_all_explicit_due_date_tasks.sql",
    import.meta.url,
  ),
  "utf8",
);

test("an open task explicitly due on the viewed date cannot be hidden by capacity", () => {
  assert.match(
    migration,
    /t\.status = 'open'[\s\S]*t\.due_date = v_work_date[\s\S]*row\.presentation_state = 'held'[\s\S]*then 'presented'/,
  );
});

test("capacity remains authoritative for overload even when it cannot suppress the card", () => {
  assert.match(migration, /explicit_due_date_over_capacity/);
  assert.match(
    migration,
    /row\.overload or \([\s\S]*held_beyond_regular_minutes[\s\S]*held_beyond_recovery_minutes[\s\S]*\) as overload/,
  );
});

test("the public resolver still delegates selection and minute accounting to the private resolver", () => {
  assert.match(
    migration,
    /from atlas\.presented_work_rows_unfiltered_v1\(p_farm_id, p_membership_id, v_work_date\) row/,
  );
  assert.doesNotMatch(migration, /regular_target_minutes|recovery_target_minutes|maximum_planned_minutes/);
});

test("unavailability and the explicit Sunday override remain intact", () => {
  assert.match(migration, /from atlas\.member_unavailability unavailable/);
  assert.match(migration, /owner_sunday_override/);
  assert.match(migration, /allow_sunday/);
  assert.match(migration, /owner_schedule_override/);
});
