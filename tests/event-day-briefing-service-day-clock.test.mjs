import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812011500_event_briefing_service_day_clock_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("time-of-day event language only applies while the requested service day is actually today", () => {
  const serviceDayGuards = migration.match(/v_now_local::date=p_day/g) ?? [];
  assert.ok(serviceDayGuards.length >= 4, "ended, underway, soon, and late-open paths should use the service-day clock");
  assert.match(normalized, /p_day=v_project\.target_date and v_now_local::date=p_day and v_now_local>=v_start_local/);
  assert.match(normalized, /p_day=v_project\.target_date and v_now_local::date=p_day and v_minutes_to_start between 0 and 90/);
  assert.match(normalized, /p_day=v_project\.target_date and v_now_local::date=p_day and v_now_local::time>=time '12:00'/);
});

test("past event dates resolve as ended even outside the event clock window", () => {
  assert.match(normalized, /if v_now_local::date>v_project\.target_date then return 'The event has ended\.'/);
});

test("future Day previews keep the ordinary morning orientation instead of borrowing today's afternoon clock", () => {
  assert.match(migration, /this morning\. Elm setup afterward\./);
  assert.match(migration, /is the first move\./);
});

test("departure and action language remains derived from canonical task truth", () => {
  assert.match(migration, /task\.metadata->>'departure_label'/);
  assert.match(migration, /when task\.task_type='harvest' then 'harvest'/);
  assert.doesNotMatch(migration, /Karianne/i);
  assert.doesNotMatch(migration, /Lebanon/i);
});
