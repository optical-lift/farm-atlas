import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const cleanup = readFileSync(
  new URL("../supabase/migrations/20260802212500_atlas_completed_work_leaves_active_feed_v1.sql", import.meta.url),
  "utf8",
);

const homeStart = cleanup.indexOf("create or replace function atlas.home_task_cards_for_membership_v2");
const journalStart = cleanup.indexOf("create or replace function atlas.journal_day_for_membership_v1");
const homeReader = cleanup.slice(homeStart, journalStart);
const journalReader = cleanup.slice(journalStart);

test("completed tasks leave the Home execution feed", () => {
  assert.ok(homeStart >= 0);
  assert.ok(journalStart > homeStart);
  assert.doesNotMatch(homeReader, /t\.status\s*=\s*'done'/);
  assert.match(homeReader, /where card\.status in \('open', 'blocked'\)/);
  assert.match(homeReader, /presented_work_rows_v1/);
});

test("legacy child steps cannot surface as future task cards", () => {
  assert.match(homeReader, /t\.parent_task_id is null/);
  assert.match(homeReader, /metadata ->> 'parent_task_id'/);
  assert.match(homeReader, /metadata ->> 'parentTaskId'/);
  assert.match(homeReader, /metadata ->> 'is_child_task'/);
});

test("Living Day keeps completion history outside the active planned feed", () => {
  assert.match(journalReader, /'planned', v_planned_open/);
  assert.doesNotMatch(journalReader, /v_planned_open\s*\|\|/);
  assert.doesNotMatch(journalReader, /v_planned_done jsonb/);
  assert.match(journalReader, /v_completed_today_count/);
  assert.match(journalReader, /'done', v_completed_today_count/);
  assert.match(journalReader, /v_legacy/);
});
