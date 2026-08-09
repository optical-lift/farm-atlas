import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const schemaMigration = await readFile(new URL("../supabase/migrations/20260807153000_atlas_project_pull_pool_v1.sql", import.meta.url), "utf8");
const conversionMigration = await readFile(new URL("../supabase/migrations/20260807154500_convert_elm_finish_tasks_to_project_pull_pool.sql", import.meta.url), "utf8");
const capacityV2 = await readFile(new URL("../supabase/migrations/20260809022500_full_paid_day_project_capacity_v2.sql", import.meta.url), "utf8");
const conveyorV1 = await readFile(new URL("../supabase/migrations/20260809022900_serial_full_paid_day_project_conveyor_v1.sql", import.meta.url), "utf8");
const projectPull = await readFile(new URL("../lib/atlas/project-pull.ts", import.meta.url), "utf8");
const homePage = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
const switchedHome = await readFile(new URL("../lib/atlas/switched-account-home-overview.ts", import.meta.url), "utf8");
const picker = await readFile(new URL("../app/project-pull/[projectId]/page.tsx", import.meta.url), "utf8");
const canonicalTask = await readFile(new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url), "utf8");
const returnRoute = await readFile(new URL("../app/api/atlas/project-pull/return/route.ts", import.meta.url), "utf8");

test("project pool remains an Atlas-scoped durable source of truth", () => {
  assert.match(schemaMigration, /create table if not exists atlas\.project_pull_items/);
  assert.match(schemaMigration, /create table if not exists atlas\.project_pull_selections/);
  assert.match(schemaMigration, /status text not null default 'available'/);
  assert.match(schemaMigration, /expected_active_minutes integer not null/);
  assert.match(schemaMigration, /physical_load text not null/);
  assert.doesNotMatch(schemaMigration, /create table if not exists public\./);
});

test("the old one-card renovation contract is preserved as history but superseded", () => {
  assert.match(conversionMigration, /stable_key='elm_finish_renovation_pool'/);
  assert.match(conversionMigration, /daily_pull_minutes',90/);
  assert.match(conversionMigration, /daily_pull_max_items',1/);
  assert.match(capacityV2, /'daily_pull_contract','paid_capacity_conveyor_v2'/);
  assert.match(capacityV2, /'daily_pull_minutes',420/);
  assert.match(capacityV2, /'daily_pull_max_items',24/);
  assert.match(capacityV2, /'one_at_a_time_release',true/);
});

test("Finish Project capacity is the remaining paid day rather than a 90-minute allowance", () => {
  assert.match(capacityV2, /when 'farm_hand' then 420/);
  assert.match(capacityV2, /v_budget := v_remaining/);
  assert.match(capacityV2, /projectPullBudgetMinutes',v_budget/);
  assert.match(capacityV2, /remaining paid-work capacity/);
  assert.match(capacityV2, /v_heavy_minutes\+v_item\.expected_active_minutes>v_heavy_cap/);
  assert.match(capacityV2, /project_pull_selection_v2/);
});

test("Owner week projection can plan several Finish Project servings in a paid day", () => {
  assert.match(capacityV2, /add column if not exists plan_order/);
  assert.match(capacityV2, /for v_iteration in 1\.\.24 loop/);
  assert.match(capacityV2, /exit when v_remaining<=15/);
  assert.match(capacityV2, /1000\+v_iteration/);
  assert.match(capacityV2, /Full paid-day fill/);
});

test("Farm Hand Conveyor releases only one actionable Finish Project serving at a time", () => {
  assert.match(conveyorV1, /create or replace function atlas\.deal_next_paid_project_work_v1/);
  assert.match(conveyorV1, /selection\.state='selected'/);
  assert.match(conveyorV1, /task\.status='open'/);
  assert.match(conveyorV1, /'state','current_serving_exists'/);
  assert.match(conveyorV1, /'state','future_plan_only'/);
  assert.match(conveyorV1, /returned\.state='returned'/);
  assert.match(conveyorV1, /perform atlas\.deal_next_paid_project_work_v1/);
  assert.match(conveyorV1, /new\.status='blocked'/);
  assert.match(conveyorV1, /new\.status='done'/);
});

test("real farm-hand Home deals from the serial paid-day plan without exposing a choice menu", () => {
  assert.match(projectPull, /ensureAtlasProjectPullTask/);
  assert.match(projectPull, /deal_next_paid_project_work_v1/);
  assert.match(projectPull, /p_allow_outdoor/);
  assert.doesNotMatch(projectPull, /Automatically dealt by the Farm Hand Conveyor/);
  assert.match(homePage, /farmHandMode && actualFarmHandMembership/);
  assert.match(homePage, /ensureAtlasProjectPullTask/);
  assert.doesNotMatch(homePage, /Choose today’s Finish Project work/);
});

test("Owner preview of a farm hand is read-only and never deals work into the worker's real day", () => {
  assert.match(switchedHome, /Owner preview is read-only/);
  assert.doesNotMatch(switchedHome, /ensureAtlasProjectPullTask/);
  assert.doesNotMatch(switchedHome, /ensureProjectWork/);
});

test("management picker now chooses the next serving without reintroducing a one-card day", () => {
  assert.match(picker, /Choose the next finish card/);
  assert.match(picker, /several Finish Project jobs to fill the paid workday/);
  assert.match(picker, /Take this one next/);
  assert.match(picker, /pull_project_item_to_today_v1/);
  assert.match(returnRoute, /return_project_item_to_pool_v1/);
  assert.match(canonicalTask, /ProjectPullTaskDetail/);
});
