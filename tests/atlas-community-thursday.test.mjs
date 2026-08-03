import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function migration(name) {
  return readFileSync(new URL(`../supabase/migrations/${name}`, import.meta.url), "utf8");
}

const program = migration("20260803033309_community_thursday_program_and_events_v1.sql");
const recurrence = migration("20260803033346_community_thursday_setup_recurrence_v1.sql");
const reminder = migration("20260803033407_community_thursday_member_reminder_v1.sql");
const bell = migration("20260803033437_bell_history_community_notice_v3.sql");
const completion = migration("20260803033502_complete_community_thursday_owner_build_task_v1.sql");
const receiptFix = migration("20260803033639_fix_bell_history_v3_receipt_key.sql");
const bellRoute = readFileSync(new URL("../app/api/atlas/bell/route.ts", import.meta.url), "utf8");

test("Thursdays at Elm owns a canonical program and dated events", () => {
  assert.match(program, /create table if not exists atlas\.community_programs/i);
  assert.match(program, /create table if not exists atlas\.community_events/i);
  assert.match(program, /'thursdays_at_elm'/);
  assert.match(program, /jsonb_build_array\(1, 3\)/);
  assert.match(program, /jsonb_build_array\(2, 4\)/);
  assert.match(program, /time '09:30'/);
  assert.match(program, /time '11:30'/);
  assert.match(program, /time '18:30'/);
  assert.match(program, /time '20:30'/);
  assert.match(program, /format\('thursdays_at_elm_%s_%s'/);
  assert.match(program, /date '2026-08-06'/);
});

test("Anna setup work follows only first and third Thursday community mornings", () => {
  assert.match(recurrence, /monthly_weekday_ordinals/);
  assert.match(recurrence, /linked_event_week_ordinals', jsonb_build_array\(1, 3\)/);
  assert.match(recurrence, /Wednesday before first and third Thursday community mornings/);
  assert.match(recurrence, /ce\.event_kind = 'free_community_morning'/);
  assert.match(recurrence, /future_events\.event_date - 1|\(ce\.event_date - 1\)/);
  assert.doesNotMatch(recurrence, /ticketed_seasonal_evening[\s\S]{0,200}planned_work_occurrences/i);
});

test("the August 5 reminder is farm-wide, future-dated, and idempotent", () => {
  assert.match(reminder, /visibility_scope[\s\S]*'farm_shared'/i);
  assert.match(reminder, /2026-08-05 19:00:00-05/);
  assert.match(reminder, /where f\.stable_key = 'elm_farm' and fm\.active = true/i);
  assert.match(reminder, /on conflict \(dedupe_key\) do update/i);
  assert.match(reminder, /\/day\?date=2026-08-06/);
});

test("Bell v3 adds community notices for every active membership", () => {
  assert.match(bell, /create or replace function atlas\.bell_history_v3/i);
  assert.match(bell, /community_event_notice/);
  assert.match(bell, /grant execute[\s\S]*authenticated, service_role/i);
  assert.match(bell, /atlas\.authenticated_rpc_registry/i);
  assert.match(receiptFix, /receipt\.journal_event_id = event\.id/i);
  assert.doesNotMatch(receiptFix, /receipt\.event_id = event\.id/i);
  assert.match(bellRoute, /supabase\.rpc\("bell_history_v3"/);
  assert.match(bellRoute, /X-Atlas-Read-Path": "bell-v3"/);
});

test("the Owner build card closes only after operational proof exists", () => {
  assert.match(completion, /if v_event_count < 10/i);
  assert.match(completion, /if v_future_setup_count < 5/i);
  assert.match(completion, /if v_outbox_count < 3/i);
  assert.match(completion, /record_task_transition_v1_internal/i);
  assert.match(completion, /'done'/);
  assert.match(completion, /community-thursday-event-bell-flow-v1:2026-08-02/);
});
