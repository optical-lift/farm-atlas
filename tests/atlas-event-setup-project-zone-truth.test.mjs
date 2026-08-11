import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812010000_event_setup_project_zone_truth_v1.sql", import.meta.url),
  "utf8",
);
const normalized = migration.replace(/\s+/g, " ").trim();

test("event setup inherits a missing zone from its canonical project place", () => {
  assert.match(migration, /sync_event_setup_task_zone_from_project_link_v1/);
  assert.match(normalized, /v_task\.task_type is distinct from 'event_setup' or v_task\.zone_id is not null/);
  assert.match(normalized, /set zone_id=v_project\.zone_id/);
  assert.match(migration, /zone_assignment_source','event_project_zone'/);
});

test("changing a project zone fills only still-placeless event setup work", () => {
  assert.match(migration, /sync_event_setup_tasks_when_project_zone_changes_v1/);
  assert.match(normalized, /task\.task_type='event_setup' and task\.zone_id is null/);
  assert.match(migration, /after update of zone_id on atlas\.projects/);
});

test("off-farm and commercial project work do not inherit event setup place", () => {
  assert.doesNotMatch(migration, /task_type in \('event_setup','harvest'/);
  assert.doesNotMatch(migration, /task_type in \('event_setup','purchase'/);
  assert.doesNotMatch(migration, /task_type in \('event_setup','marketing'/);
});

test("the current event reconciliation uses stable project and zone identity", () => {
  assert.match(migration, /project\.stable_key='elm_first_ticketed_thursday_bloom_bar_2026_08_13'/);
  assert.match(migration, /zone\.stable_key='venue'/);
  assert.doesNotMatch(migration, /a260dd83-e028-4bf5-a1ff-d26c985563dc/i);
  assert.doesNotMatch(migration, /19c7c573-fda5-4624-8d53-c607860959d5/i);
});

test("broad zone truth does not invent round-table or restroom micro-objects", () => {
  assert.doesNotMatch(migration, /round table by windows/i);
  assert.doesNotMatch(migration, /round table by clock/i);
  assert.doesNotMatch(migration, /staircase console/i);
  assert.doesNotMatch(migration, /basement restroom route/i);
  assert.doesNotMatch(migration, /insert into atlas\.growing_objects/i);
});

test("trigger helpers are not directly executable by signed-in clients", () => {
  assert.match(migration, /revoke all on function atlas\.sync_event_setup_task_zone_from_project_link_v1\(\) from public,anon,authenticated/);
  assert.match(migration, /revoke all on function atlas\.sync_event_setup_tasks_when_project_zone_changes_v1\(\) from public,anon,authenticated/);
});
