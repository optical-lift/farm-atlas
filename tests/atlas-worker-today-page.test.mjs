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
  assert.match(board, /setCompletedTaskIds/);
  assert.match(board, /router\.refresh\(\)/);
  assert.doesNotMatch(board, /\/api\/atlas\/work\/tasks/);
  assert.doesNotMatch(board, /worker_record_task_transition_v1/);
});

test("worker Today preserves Anna's familiar Done and Unfinished flow", () => {
  const board = read("app/work/today/WorkerTodayBoard.tsx");

  for (const label of [
    "Done",
    "Unfinished",
    "What happened?",
    "Partly done",
    "Blocked",
    "Reschedule",
    "Tomorrow",
    "Next week",
    "Pick a date",
    "Close without doing it",
    "Changed plan",
    "Not relevant",
  ]) {
    assert.match(board, new RegExp(label.replace(/[?]/g, "\\?")));
  }

  for (const transition of [
    "done",
    "partial",
    "blocked",
    "rescheduled",
    "changed_plan",
    "not_relevant",
  ]) {
    assert.match(board, new RegExp(`apply\\("${transition}"`));
  }

  assert.match(board, /window\.prompt\("What is left\?"/);
  assert.match(board, /window\.prompt\("What blocked it\?"/);
  assert.match(board, /window\.prompt\("Pick a date \(YYYY-MM-DD\)"/);
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

test("task focus accepts only known internal return destinations", () => {
  const focusPage = read("app/task-focus/[taskId]/page.tsx");
  const collectionView = read("components/atlas/CanonicalMaintenanceCollectionView.tsx");

  assert.match(focusPage, /SAFE_RETURN_PATHS/);
  assert.match(focusPage, /"\/work\/today"/);
  assert.match(focusPage, /"\/collections\/mowing"/);
  assert.match(focusPage, /"\/collections\/weeding"/);
  assert.match(focusPage, /value\.startsWith\("\/\/"\)/);
  assert.match(focusPage, /listPath: returnTo/);
  assert.match(collectionView, /returnTo=\$\{encodeURIComponent\(returnTo\)\}/);
});

test("the full task page keeps the familiar Unfinished drawer and next-day intent", () => {
  const detail = read("components/atlas/canonical-assigned-task-detail.tsx");

  assert.match(detail, /"Unfinished"/);
  assert.match(detail, />Partly done</);
  assert.match(detail, />Tomorrow</);
  assert.match(detail, />Next week</);
  assert.match(detail, />Pick a date</);
  assert.match(detail, />Changed plan</);
  assert.match(detail, />Not relevant</);
  assert.match(detail, /scheduleIntent: "next_day"/);
});
