import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const exists = (path) => existsSync(new URL(`../${path}`, import.meta.url));

const page = read("app/objects/[objectKey]/page.tsx");
const retirement = read("supabase/migrations/20260811001845_atlas_retire_object_work_subsystem_v1.sql");

test("Object Work no longer owns a presentation surface on canonical object pages", () => {
  assert.doesNotMatch(page, /ObjectWorkComposer/);
  assert.doesNotMatch(page, /object-work-composer/);
  assert.match(page, /MaintenanceDirectiveComposer/);
  assert.match(page, /AtlasTrail/);
  assert.match(page, /ObjectQuickLog/);
  assert.equal(exists("components/atlas/object-work-composer.tsx"), false);
  assert.equal(exists("components/atlas/object-work-task-strip.tsx"), false);
});

test("retirement removes the competing worker and task-detail surfaces", () => {
  assert.equal(exists("components/atlas/task-dominion-trail.tsx"), false);
  assert.equal(exists("components/atlas/dominion-assigned-task-detail.tsx"), false);
  assert.equal(exists("lib/atlas/task-condition-rail.ts"), false);
  assert.equal(exists("lib/atlas/task-dominion.ts"), false);
  assert.equal(exists("components/atlas/concise-weed-task-detail.tsx"), false);
});

test("Object Work runtime authoring seams are gone", () => {
  assert.equal(exists("lib/atlas/object-work-client.ts"), false);
  assert.equal(exists("app/api/atlas/objects/[objectKey]/work/route.ts"), false);
  assert.equal(exists("app/api/atlas/object-work/route.ts"), false);
});

test("the retirement migration removes only the empty parallel Object Work subsystem", () => {
  assert.match(retirement, /drop trigger if exists trg_sync_object_work_from_task_status_v1 on atlas\.tasks/i);
  assert.match(retirement, /drop trigger if exists trg_sync_object_work_release_v1 on atlas\.planned_work_occurrences/i);
  assert.match(retirement, /drop table if exists atlas\.object_work_crop_cycles/i);
  assert.match(retirement, /drop table if exists atlas\.object_work_steps/i);
  assert.match(retirement, /drop table if exists atlas\.object_work_items/i);
  assert.match(retirement, /drop column if exists operational_truth_work_item_id/i);
  assert.match(retirement, /signature not ilike 'atlas\.object_workbench_v1\(%'/i);
  assert.doesNotMatch(retirement, /drop function if exists atlas\.object_workbench_v1/i);
  assert.doesNotMatch(retirement, /drop (table|view) if exists atlas\.v_object_workbench/i);
});
