import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812004500_event_briefing_departure_derived_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("event briefing derives the first departure from canonical project-linked worker work", () => {
  assert.match(normalized, /from atlas\.project_task_links link join atlas\.tasks task on task\.id=link\.task_id/);
  assert.match(normalized, /task\.assigned_membership_id=p_membership_id/);
  assert.match(normalized, /task\.visibility_scope='assigned_worker'/);
  assert.match(normalized, /task\.status in \('open','blocked'\)/);
  assert.match(normalized, /task\.metadata->>'departure_label'/);
  assert.match(normalized, /task\.metadata->>'location_name'/);
  assert.match(normalized, /task\.metadata->>'address'/);
});

test("event briefing derives a human action instead of encoding one acceptance case", () => {
  assert.match(normalized, /when task\.task_type='harvest' then 'harvest'/);
  assert.match(normalized, /when task\.task_type='field_work' then 'work'/);
  assert.match(normalized, /task\.metadata->>'display_action'/);
  assert.doesNotMatch(migration, /Karianne/i);
  assert.doesNotMatch(migration, /Lebanon/i);
});

test("late-open and event-underway behavior remains present-time aware", () => {
  assert.match(migration, /v_now_local timestamp:=now\(\) at time zone 'America\/Chicago'/);
  assert.match(migration, /v_minutes_to_start between 0 and 90/);
  assert.match(migration, /The event starts soon\./);
  assert.match(migration, /The event is underway\./);
  assert.match(migration, /The event has ended\./);
  assert.match(migration, /is still open\. Elm setup follows\./);
  assert.match(migration, /this morning\. Elm setup afterward\./);
});

test("briefing remains read-only orientation", () => {
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
  assert.doesNotMatch(migration, /update atlas\.tasks/i);
  assert.doesNotMatch(migration, /delete from atlas\.tasks/i);
});
