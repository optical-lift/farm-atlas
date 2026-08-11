import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812013000_event_briefing_compact_orientation_v1.sql", import.meta.url),
  "utf8",
);

test("first-open event briefing does not count the downstream task chain into worker orientation", () => {
  assert.doesNotMatch(migration, /v_remaining::text\|\|' moves/);
  assert.doesNotMatch(migration, /assigned moves remain/);
  assert.match(migration, /this morning\. Elm setup afterward\./);
  assert.match(migration, /is still open\. Elm setup follows\./);
});

test("late-open briefing foregrounds guest readiness without inventory prose", () => {
  assert.match(migration, /The event starts soon\. Make guest arrival ready first\./);
  assert.match(migration, /The event is underway\. Do only what still helps guests now\./);
});

test("the briefing still knows when all assigned event work is finished", () => {
  assert.match(migration, /if v_remaining=0 then/);
  assert.match(migration, /Everything assigned to you for tonight is already finished\./);
});

test("place/action truth remains derived and service-day time remains guarded", () => {
  assert.match(migration, /task\.metadata->>'departure_label'/);
  assert.match(migration, /when task\.task_type='harvest' then 'harvest'/);
  assert.match(migration, /v_now_local::date=p_day/);
  assert.doesNotMatch(migration, /Karianne/i);
  assert.doesNotMatch(migration, /Lebanon/i);
});
