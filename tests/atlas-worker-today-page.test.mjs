import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("worker Today is built from the canonical schedule and worker membership context", () => {
  const page = read("app/work/today/page.tsx");

  assert.match(page, /getWorkerHand/);
  assert.match(page, /getDaySchedule/);
  assert.match(page, /atlasScheduleRouteKey/);
  assert.match(page, /WorkerTodayBoard/);
  assert.doesNotMatch(page, /hand\.lanes/);
  assert.doesNotMatch(page, /fetchAtlasTaskCards/);
  assert.doesNotMatch(page, /SUPABASE_SERVICE_ROLE_KEY/);
});

test("worker Today actions use the shared authenticated transition client", () => {
  const board = read("app/work/today/WorkerTodayBoard.tsx");

  assert.match(board, /postAtlasTaskTransition/);
  assert.match(board, /source: "worker_today"/);
  assert.match(board, /setHiddenTaskIds/);
  assert.match(board, /router\.refresh\(\)/);
  assert.doesNotMatch(board, /\/api\/atlas\/work\/tasks/);
  assert.doesNotMatch(board, /worker_record_task_transition_v1/);
});

test("worker Today preserves mowing and weeding as collection cards", () => {
  const page = read("app/work/today/page.tsx");
  const board = read("app/work/today/WorkerTodayBoard.tsx");

  assert.match(page, /atlasIsMaintenanceCollectionRoute/);
  assert.match(page, /\/collections\/mowing/);
  assert.match(page, /\/collections\/weeding/);
  assert.match(board, /Maintenance collections/);
  assert.match(board, /carryoverCount/);
  assert.match(board, /blockedCount/);
});
