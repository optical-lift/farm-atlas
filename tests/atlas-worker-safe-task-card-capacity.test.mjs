import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260804062000_hide_capacity_metadata_from_task_cards.sql", import.meta.url),
  "utf8",
);

test("the universal task-card projection strips all capacity underbelly", () => {
  assert.match(migration, /create or replace view atlas\.v_task_cards/);
  assert.match(migration, /security_invoker = true/);

  for (const key of [
    "effort_units",
    "effort_band",
    "estimated_minutes",
    "duration_minutes",
    "timeboxed_minutes",
    "packet_target_hours",
    "packet_day_target_hours",
    "capacity_blocked",
    "capacity_blocker",
    "capacity_observed_date",
    "dependency_delay_minutes",
  ]) {
    assert.match(migration, new RegExp(`- '${key}'`), `${key} must be removed from task cards`);
  }
});

test("operational task content remains in the task card", () => {
  assert.match(migration, /t\.title/);
  assert.match(migration, /t\.note/);
  assert.match(migration, /t\.unlock_text/);
  assert.match(migration, /t\.blocker_text/);
  assert.match(migration, /resource_requirements/);
  assert.match(migration, /task_transitions/);
});
