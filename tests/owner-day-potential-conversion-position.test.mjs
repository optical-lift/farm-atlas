import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const migration = read("supabase/migrations/20260813154800_preserve_accepted_potential_position_v1.sql");
const route = read("app/api/atlas/owner-day-commit/route.ts");
const board = read("components/atlas/owner-day-schedule-builder.tsx");

test("accepted purple work resolves its slot after white-card draft edits", () => {
  const editsIndex = migration.indexOf("v_edit_result:=atlas.owner_apply_worker_day_edits_api_v1");
  const positionIndex = migration.indexOf("v_position_plan:=atlas.owner_worker_day_plan_choreographed_v1");
  const scheduleIndex = migration.indexOf("v_schedule_result:=atlas.owner_build_worker_day_schedule_api_v2");
  assert.ok(editsIndex >= 0);
  assert.ok(positionIndex > editsIndex);
  assert.ok(scheduleIndex > positionIndex);
  assert.match(migration, /v_suggestion->>'dayWindow'/);
  assert.match(migration, /v_suggestion->>'workOrderNumber'/);
  assert.match(migration, /v_sort_order:=v_sort_order\+0\.001/);
});

test("the accepted source card maps to the exact canonical task returned by the existing schedule builder", () => {
  assert.match(migration, /v_schedule_result->'results'/);
  assert.match(migration, /item->>'sourceKind'=v_position->>'sourceKind'/);
  assert.match(migration, /item->>'sourceId'=v_position->>'sourceId'/);
  assert.match(migration, /v_task_id:=nullif\(v_schedule_row->>'taskId',''\)::uuid/);
  assert.match(migration, /Atlas could not preserve the accepted card identity/);
  assert.doesNotMatch(migration, /insert\s+into\s+atlas\.tasks/i);
});

test("the resulting white task receives one explicit placement in the preserved slot", () => {
  assert.match(migration, /v_generated_placement_edits/);
  assert.match(migration, /'kind','place'/);
  assert.match(migration, /'taskId',v_task_id/);
  assert.match(migration, /'serviceDate',p_day/);
  assert.match(migration, /'dayWindow',v_position->>'dayWindow'/);
  assert.match(migration, /'sortOrder',\(v_position->>'sortOrder'\)::numeric/);
  assert.match(migration, /v_accepted_placement_result:=atlas.owner_apply_worker_day_edits_api_v1/);
  assert.match(migration, /'acceptedPlacements',v_accepted_placement_result/);
});

test("Pass 6 keeps the existing single Owner Day commit boundary and client contract", () => {
  assert.match(migration, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(migration, /owner_build_worker_day_schedule_api_v2/);
  assert.match(route, /owner_commit_worker_day_choreography_api_v1/);
  assert.match(board, /owner-day-commit-v1/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-schedule"/);
  assert.doesNotMatch(board, /fetch\("\/api\/atlas\/owner-day-edit"/);
});
