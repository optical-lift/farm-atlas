import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260804070500_thursday_morning_execution_checklist_v1.sql");
const occurrenceMigration = read("supabase/migrations/20260804070600_thursday_morning_occurrence_contract_v1.sql");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const detail = read("components/atlas/execution-checklist-task-detail.tsx");
const route = read("app/api/atlas/task-execution-checklist/route.ts");

test("Thursday morning prep is one canonical visible checklist rather than child tasks or hidden Steps", () => {
  assert.match(canonical, /ExecutionChecklistTaskDetail/);
  assert.match(canonical, /execution_checklist_template_key/);
  assert.match(detail, /atlas-execution-checklist__section/);
  assert.match(detail, /Wednesday closing round/);
  assert.doesNotMatch(detail, /TaskChildChecklist/);
  assert.doesNotMatch(detail, /atlas-task-procedure/);
  assert.doesNotMatch(detail, />Steps</);
});

test("the regular Thursday morning checklist matches the owner-defined rooms and wording", () => {
  assert.match(migration, /Store farm tools in their proper places/);
  assert.match(migration, /Tidy the farm work areas/);
  assert.match(migration, /Wash and stage the harvest buckets/);
  assert.match(migration, /Make cold brew and refrigerate it overnight/);
  assert.match(migration, /Restock and reset the coffee bar/);
  assert.match(migration, /Refill the water dispenser/);
  assert.match(migration, /Clean the bathroom and leave it ready for guests/);
  assert.match(migration, /Stock the bathroom supplies/);
  assert.match(migration, /Clear the Library surfaces/);
  assert.match(migration, /Reset the Library furniture/);
  assert.match(migration, /Clear the meeting room surfaces/);
  assert.match(migration, /Reset the meeting room furniture/);
  assert.match(migration, /Take out the kitchen trash/);
  assert.match(migration, /Confirm the bathroom, coffee bar, Library, and meeting room are ready/);
  assert.doesNotMatch(migration, /guest-area trash/i);
  assert.doesNotMatch(migration, /Lounge/);
  assert.doesNotMatch(migration, /Sweep porches/);
  assert.doesNotMatch(migration, /Pick up sticks/);
  assert.doesNotMatch(migration, /temperature/i);
  assert.doesNotMatch(migration, /animal check/i);
});

test("checklist state is canonical, append-only in history, and required before completion", () => {
  assert.match(migration, /task_execution_checklist_items/);
  assert.match(migration, /task_execution_checklist_events/);
  assert.match(migration, /record_task_execution_check_v1/);
  assert.match(migration, /guard_required_execution_checklist_v1/);
  assert.match(migration, /Complete every required checklist item before marking this round ready/);
  assert.match(detail, /checklist\?\.ready !== true/);
  assert.match(detail, /Elm is ready for Thursday morning/);
});

test("the checklist API is role-aware and supports owner operator mode", () => {
  assert.match(route, /task-execution-checklist-v1/);
  assert.match(route, /effectiveOperatorMembershipId/);
  assert.match(route, /task_execution_checklist_v1/);
  assert.match(route, /record_task_execution_check_v1/);
});

test("future regular Thursday morning occurrences inherit the same checklist template", () => {
  assert.match(occurrenceMigration, /community_thursday_wednesday_setup:%/);
  assert.match(occurrenceMigration, /community_thursday_morning_v1/);
  assert.match(occurrenceMigration, /Prepare Elm for Thursday Morning/);
  assert.match(occurrenceMigration, /paid_event_scope',false/);
});
