import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260809003500_calendar_truth_and_serial_queue_semantics.sql", import.meta.url),
  "utf8",
);
const carryMigration = readFileSync(
  new URL("../supabase/migrations/20260809161500_carry_unfinished_work_to_next_worker_day.sql", import.meta.url),
  "utf8",
);
const dayRoute = readFileSync(new URL("../lib/atlas/day-route.ts", import.meta.url), "utf8");
const taskCardsClient = readFileSync(new URL("../lib/atlas/task-cards-client.ts", import.meta.url), "utf8");
const universalRoute = readFileSync(new URL("../app/api/atlas/universal-task-cards/route.ts", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("serial weed backlog is not calendar truth", () => {
  assert.match(migration, /calendar_commitment_kind','queue_only'/);
  assert.match(migration, /planned_due_date=null,not_before_date=null/);
  assert.match(migration, /'release_timing','same_day'/);
  assert.match(migration, /queue_original_planned_due_date/);
  assert.match(migration, /dependency_hard_date/);
  assert.match(migration, /barn_beds_walkway_grass_2026/);
  assert.match(migration, /serial_queue_bypass/);
});

test("weed card cue reports only real scheduled exceptions, never reservoir size", () => {
  assert.match(migration, /release_queue_scheduled_after_count/);
  assert.match(dayRoute, /release_queue_scheduled_after_count/);
  assert.match(dayRoute, /weed job.*scheduled later/);
  assert.doesNotMatch(dayRoute, /release_queue_queued_count/);
  assert.doesNotMatch(dayRoute, /areas need.*attention after this one/);
});

test("future presented work remains exact-date calendar truth before carry-forward", () => {
  assert.match(migration, /v_today date:=\(now\(\) at time zone 'America\/Chicago'\)::date/);
  assert.match(migration, /where v_work_date<=v_today or task\.due_date=v_work_date/);
  assert.match(carryMigration, /target_presented/);
  assert.match(carryMigration, /prior_presented/);
});

test("future Day asks for one date, preserves carry-forward, and then applies explicit Owner placement", () => {
  assert.match(taskCardsClient, /exactDate\?: string/);
  assert.match(taskCardsClient, /viewerParams\.set\("exactDate", viewerWindow\.exactDate\)/);
  assert.match(universalRoute, /requestedExactDate/);
  assert.match(universalRoute, /server-side worker-day reader remains authoritative for ordinary day/);
  assert.match(universalRoute, /Explicit Owner placement is a narrow override layered on top/);
  assert.match(universalRoute, /worker_day_choreography_api_v1/);
  assert.match(universalRoute, /worker_day_placed_task_cards_v1/);
  assert.doesNotMatch(universalRoute, /card\.due_date === exactDate/);
  assert.match(dayPage, /exactDate: isFutureDay \? dateIso : undefined/);
  assert.match(carryMigration, /member_day_carryover_v1/);
  assert.match(carryMigration, /withheldUnderSky/);
});

test("future Day is labeled as a schedule instead of an indiscriminate overdue dump", () => {
  assert.match(dayPage, /const isFutureDay = dateIso > calendarToday/);
  assert.match(dayPage, /isFutureDay \? `\$\{openRequiredCount\} scheduled/);
  assert.match(dayPage, /tasks scheduled for this day/);
  assert.match(dayPage, /dateIso === calendarToday \? nextTaskForCurrentWindow/);
  assert.match(dayPage, /!isFutureDay && livingDay \? <LivingDayCarried/);
  assert.match(carryMigration, /v_previous_work_date/);
  assert.match(carryMigration, /extract\(isodow from p_work_date\) = 7/);
});
