import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260809003500_calendar_truth_and_serial_queue_semantics.sql", import.meta.url),
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

test("future presented work is an exact-date calendar read", () => {
  assert.match(migration, /v_today date:=\(now\(\) at time zone 'America\/Chicago'\)::date/);
  assert.match(migration, /where v_work_date<=v_today or task\.due_date=v_work_date/);
});

test("future Day asks the universal task reader for one exact date", () => {
  assert.match(taskCardsClient, /exactDate\?: string/);
  assert.match(taskCardsClient, /viewerParams\.set\("exactDate", viewerWindow\.exactDate\)/);
  assert.match(universalRoute, /requestedExactDate/);
  assert.match(universalRoute, /card\.due_date === exactDate/);
  assert.match(dayPage, /exactDate: isFutureDay \? dateIso : undefined/);
});

test("future Day is labeled as a schedule instead of accumulated unfinished work", () => {
  assert.match(dayPage, /const isFutureDay = dateIso > calendarToday/);
  assert.match(dayPage, /isFutureDay \? `\$\{openRequiredCount\} scheduled/);
  assert.match(dayPage, /tasks scheduled for this day/);
  assert.match(dayPage, /dateIso === calendarToday \? nextTaskForCurrentWindow/);
  assert.match(dayPage, /!isFutureDay && livingDay \? <LivingDayCarried/);
});
