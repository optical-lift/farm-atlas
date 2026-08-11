import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260811215500_atlas_event_day_briefing_late_open_v2.sql", import.meta.url),
  "utf8",
);
const delivery = readFileSync(new URL("../app/day/DayCueDelivery.tsx", import.meta.url), "utf8");

test("dynamic event briefings derive their expiry from the event's real local end time", () => {
  assert.match(migration, /event_project_end_at_v1/);
  assert.match(migration, /metadata->>'event_time_end'/);
  assert.match(migration, /at time zone 'America\/Chicago'/);
  assert.match(migration, /prepare_dynamic_event_briefing_expiry_v1/);
  assert.match(migration, /new\.expires_at:=v_event_end/);
  assert.match(migration, /new\.recovery_policy:='expire'/);
  assert.match(migration, /update atlas\.worker_day_cues cue/);
  assert.match(delivery, /if \(cue\.expiresAt && cue\.expiresAt <= nowIso\) return false/);
});

test("first-open briefing changes language as the event approaches and begins", () => {
  assert.match(migration, /v_now_local timestamp:=now\(\) at time zone 'America\/Chicago'/);
  assert.match(migration, /v_start_local/);
  assert.match(migration, /v_end_local/);
  assert.match(migration, /v_minutes_to_start between 0 and 90/);
  assert.match(migration, /The event starts soon\./);
  assert.match(migration, /The event is underway\./);
  assert.match(migration, /Do only what still helps guests now\./);
  assert.match(migration, /The event has ended\./);
});

test("late afternoon no longer tells the worker an unfinished Lebanon harvest is this morning", () => {
  assert.match(migration, /v_now_local::time>=time '12:00' and v_lebanon_harvest/);
  assert.match(migration, /Lebanon harvest is still open\. Elm setup follows\./);
  assert.match(migration, /Lebanon harvest this morning\. Elm setup afterward\./);
});

test("briefing remains derived from canonical project-linked worker work", () => {
  assert.match(migration, /project_task_links/);
  assert.match(migration, /assigned_membership_id=p_membership_id/);
  assert.match(migration, /visibility_scope='assigned_worker'/);
  assert.match(migration, /task\.status in \('open','blocked'\)/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
});
