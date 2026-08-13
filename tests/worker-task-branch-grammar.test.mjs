import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const stateful = read("components/atlas/stateful-child-checklist.tsx");
const move = read("components/atlas/task-move-spine.tsx");
const execution = read("lib/atlas/task-execution.ts");
const harvest = read("components/atlas/weekly-harvest-task-detail.tsx");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const cleanup = read("supabase/migrations/20260813025500_worker_task_content_cleanup_v1.sql");

test("stateful children keep real state transitions while sharing the branch visual grammar", () => {
  assert.match(stateful, /postAtlasTaskTransition/);
  assert.match(stateful, /checklist_done/);
  assert.match(stateful, /checklist_open/);
  assert.match(stateful, /final \? "└──" : "├──"/);
  assert.match(stateful, /atlas-stateful-children__branch/);
  assert.doesNotMatch(stateful, /grid-template-columns:22px minmax\(0,1fr\) auto/);
});

test("Task Move requirements use the same branch geometry without reviving generic finished-state narration", () => {
  assert.match(move, /final \? "└──" : "├──"/);
  assert.match(move, /atlas-worker-move__branch/);
  assert.match(move, /Not yet confirmed/);
  assert.doesNotMatch(move, />Do this</i);
  assert.doesNotMatch(move, />Finished</i);
});

test("tasks with no actual method do not invent a fake instructions step", () => {
  assert.match(execution, /return lines\.slice\(0, 2\)/);
  assert.doesNotMatch(execution, /Follow the task instructions for this move/);
});

test("weekly harvest candidates come from Harvest Horizon rather than hardcoded crop names", () => {
  assert.match(canonical, /isWeeklyHarvestTask/);
  assert.match(canonical, /WeeklyHarvestTaskDetail/);
  assert.match(harvest, /\/api\/atlas\/harvest-horizon/);
  assert.match(harvest, /wave\.bucket === "cutting" \|\| wave\.bucket === "now"/);
  assert.match(harvest, /wave\.cropLabel/);
  for (const crop of ["lemon basil", "goldenrod", "yarrow", "lamb’s ear", "lamb's ear"]) {
    assert.doesNotMatch(harvest.toLowerCase(), new RegExp(crop.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(cleanup, /task_series_key = 'anna_harvest_thursday_weekly'/);
  assert.match(cleanup, /metadata = coalesce\(metadata, '\{\}'::jsonb\) - 'execution_how'/);
});

test("wrapping station no longer gives Anna a conditional tape instruction", () => {
  assert.match(cleanup, /thursdays_retail_stock_wrapping_station/);
  assert.match(cleanup, /- 'substitution_plan'/);
  assert.match(cleanup, /not ilike '%usable tape%'/);
  assert.doesNotMatch(cleanup, /If Anna already has usable tape, add it; do not hold the station for a tape purchase\./);
});
