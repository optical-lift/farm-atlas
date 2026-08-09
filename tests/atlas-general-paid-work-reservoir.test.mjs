import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(new URL("../supabase/migrations/20260809030500_general_paid_work_reservoir_v1.sql", import.meta.url), "utf8");
const projectPull = await readFile(new URL("../lib/atlas/project-pull.ts", import.meta.url), "utf8");
const projectionReader = await readFile(new URL("../lib/atlas-data/owner-week-projection.ts", import.meta.url), "utf8");
const projectionUi = await readFile(new URL("../components/atlas/owner-tentative-day-projection.tsx", import.meta.url), "utf8");

test("Owner projection has a first-class source kind for existing undated paid Atlas tasks", () => {
  assert.match(migration, /'floating_task'::text/);
  assert.match(migration, /create or replace function atlas\.floating_paid_work_candidates_v1/);
  assert.match(projectionReader, /"floating_task"/);
  assert.match(projectionUi, /Atlas paid-work pool/);
});

test("general floating candidates preserve canonical gates instead of swallowing serial or personal work", () => {
  assert.match(migration, /task\.due_date is null/);
  assert.match(migration, /task\.work_lane='discretionary'/);
  assert.match(migration, /task\.commitment_kind='floating'/);
  assert.match(migration, /personal_task/);
  assert.match(migration, /paid_work/);
  assert.match(migration, /task_prerequisites_ready_v1/);
  assert.match(migration, /withheldUnderSky/);
  assert.match(migration, /task_release_queue_items/);
  assert.match(migration, /queue_item\.state in \('active','queued'\)/);
  assert.match(migration, /project_pull_item_id/);
});

test("future planning uses real undated tasks before project-pool filler without redating them", () => {
  const floatingLoop = migration.indexOf("Existing canonical, undated paid tasks are a first-class reservoir");
  const projectLoop = migration.indexOf("Finish Elm remains one reservoir source");
  assert.ok(floatingLoop >= 0 && projectLoop > floatingLoop);
  assert.match(migration, /'floating_task',v_floating\.task_id/);
  assert.match(migration, /task date remains unchanged/);
  assert.doesNotMatch(migration, /update atlas\.tasks\s+set due_date/);
});

test("past projection history does not strand unfinished reservoir work forever", () => {
  assert.match(migration, /reserved\.planned_date>=v_today/);
  assert.doesNotMatch(migration, /reserved\.planned_date<>v_date/);
});

test("Finish Elm presence hold stays authoritative inside the general reservoir", () => {
  assert.match(migration, /project\.stable_key='elm_finish_renovation_pool'/);
  assert.match(migration, /project\.metadata->>'daily_pull_enabled'/);
  assert.match(migration, /daily_pull_enabled'\)::boolean,false\)=true/);
  assert.match(migration, /off-site hold cannot leak project work back into the day/);
});

test("same-day refill reuses an already-presented floating task before materializing project work", () => {
  assert.match(migration, /create or replace function atlas\.deal_next_paid_work_v1/);
  assert.match(migration, /presented_work_rows_v1/);
  assert.match(migration, /'state','adopted_floating_serving'/);
  assert.match(migration, /'sourceKind','floating_task'/);
  assert.match(migration, /deal_next_paid_project_work_v1/);
  const dealBody = migration.slice(migration.indexOf("create or replace function atlas.deal_next_paid_work_v1"));
  assert.doesNotMatch(dealBody, /insert into atlas\.tasks/);
});

test("farm-hand Home now asks the general conveyor for the next paid serving", () => {
  assert.match(projectPull, /deal_next_paid_work_v1/);
  assert.match(projectPull, /PaidWorkConveyorResult/);
  assert.match(projectPull, /sourceKind\?: "floating_task" \| "project_pull"/);
});
