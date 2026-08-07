import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaMigration = await readFile(new URL("../supabase/migrations/20260807153000_atlas_project_pull_pool_v1.sql", import.meta.url), "utf8");
const conversionMigration = await readFile(new URL("../supabase/migrations/20260807154500_convert_elm_finish_tasks_to_project_pull_pool.sql", import.meta.url), "utf8");
const guardrailsMigration = await readFile(new URL("../supabase/migrations/20260807160000_project_pull_guardrails_v1.sql", import.meta.url), "utf8");
const statusMigration = await readFile(new URL("../supabase/migrations/20260807161500_project_pull_status_v1.sql", import.meta.url), "utf8");
const projectPull = await readFile(new URL("../lib/atlas/project-pull.ts", import.meta.url), "utf8");
const switchedHome = await readFile(new URL("../lib/atlas/switched-account-home-overview.ts", import.meta.url), "utf8");
const picker = await readFile(new URL("../app/project-pull/[projectId]/page.tsx", import.meta.url), "utf8");
const canonicalTask = await readFile(new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url), "utf8");
const returnRoute = await readFile(new URL("../app/api/atlas/project-pull/return/route.ts", import.meta.url), "utf8");

test("project pool is an Atlas-scoped durable source of truth", () => {
  assert.match(schemaMigration, /create table if not exists atlas\.project_pull_items/);
  assert.match(schemaMigration, /create table if not exists atlas\.project_pull_selections/);
  assert.match(schemaMigration, /status text not null default 'available'/);
  assert.match(schemaMigration, /expected_active_minutes integer not null/);
  assert.match(schemaMigration, /physical_load text not null/);
  assert.doesNotMatch(schemaMigration, /create table if not exists public\./);
});

test("Elm departure sprint becomes an undated pool instead of another rollover queue", () => {
  assert.match(conversionMigration, /stable_key='elm_finish_renovation_pool'/);
  assert.match(conversionMigration, /target_date=null/);
  assert.match(conversionMigration, /daily_pull_minutes',90/);
  assert.match(conversionMigration, /daily_pull_max_items',1/);
  assert.match(conversionMigration, /status='archived'/);
  assert.match(conversionMigration, /due_date=null/);
});

test("pulling materializes ordinary dated work while the durable item remains project-owned", () => {
  assert.match(schemaMigration, /create or replace function atlas\.pull_project_item_to_today_v1/);
  assert.match(schemaMigration, /insert into atlas\.tasks/);
  assert.match(schemaMigration, /'project_pull_item'/);
  assert.match(schemaMigration, /insert into atlas\.project_pull_selections/);
  assert.match(schemaMigration, /set status='selected',active_task_id=v_task_id/);
});

test("Daily Hand project pull enforces one capacity-aware choice and true dependencies", () => {
  assert.match(guardrailsMigration, /daily_pull_max_items/);
  assert.match(guardrailsMigration, /Today's project pull is already full/);
  assert.match(guardrailsMigration, /does not fit today''s remaining project pull budget/);
  assert.match(guardrailsMigration, /Second Coat/);
  assert.match(guardrailsMigration, /First Coat/);
  assert.match(statusMigration, /completeForToday/);
  assert.match(statusMigration, /remainingPullMinutes/);
});

test("farm-hand home reserves one visible Daily Hand slot for project choice", () => {
  assert.match(projectPull, /buildAtlasProjectPullMove/);
  assert.match(projectPull, /Choose today’s Finish Project work/);
  assert.match(projectPull, /filter\(\(option\) => option\.fitsToday\)/);
  assert.match(switchedHome, /buildAtlasProjectPullMove/);
  assert.match(switchedHome, /overview\.moves\.slice\(0, 3\)/);
  assert.match(switchedHome, /projectMove/);
});

test("picker materializes a selected card and unchosen work has no reschedule consequence", () => {
  assert.match(picker, /pull_project_item_to_today_v1/);
  assert.match(picker, /Take this one today/);
  assert.match(picker, /stays in the Elm Finish \+ Renovation Pool with no overdue date/);
  assert.match(returnRoute, /return_project_item_to_pool_v1/);
  assert.match(canonicalTask, /ProjectPullTaskDetail/);
});
