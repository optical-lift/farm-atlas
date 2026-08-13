import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const rootLayout = read("app/layout.tsx");
const dayLayout = read("app/day/layout.tsx");
const taskLayout = read("app/task-focus/[taskId]/layout.tsx");
const globalCue = read("app/GlobalDayCueDelivery.tsx");
const dismissRoute = read("app/api/atlas/day-cue-dismiss/route.ts");
const cueMigration = read("supabase/migrations/20260813022500_worker_day_cue_dismiss_v1.sql");
const executionBrief = read("components/atlas/task-execution-brief.tsx");
const checklist = read("components/atlas/stateful-child-checklist.tsx");
const factsMigration = read("supabase/migrations/20260813023000_restore_worker_execution_facts_v1.sql");

test("worker Day cues mount once in the universal app shell, not inside Day or Task Focus", () => {
  assert.match(rootLayout, /GlobalDayCueDelivery/);
  assert.doesNotMatch(dayLayout, /DayCueDelivery/);
  assert.doesNotMatch(taskLayout, /TaskFocusCueDelivery/);
  assert.match(globalCue, /data-atlas-global-cue-delivery/);
  assert.match(globalCue, /routeDate\(searchParams\)/);
});

test("cue dismissal persists for workers and does not mutate Owner previews", () => {
  assert.match(globalCue, /\/api\/atlas\/day-cue-dismiss/);
  assert.match(globalCue, /sessionStorage\.setItem/);
  assert.match(globalCue, /if \(isOperatorPreview\)/);
  assert.match(dismissRoute, /worker_dismiss_day_cue_api_v1/);
  assert.match(cueMigration, /fm\.user_id=auth\.uid\(\)/);
  assert.match(cueMigration, /status='dismissed'/);
});

test("task focus keeps canonical subject, timing facts, and next-state facts visible", () => {
  assert.match(executionBrief, /display_subject/);
  assert.match(executionBrief, /detail_lines/);
  assert.match(executionBrief, /projection_detail_lines/);
  assert.match(executionBrief, /worker_result_lines/);
  assert.match(executionBrief, /VisibleFacts label=\{detailHeading\}/);
});

test("cold brew recipe is restored and checklist steps have deliberate order", () => {
  assert.match(factsMigration, /2 cups coarsely ground coffee \+ 6 cups cold water/);
  assert.match(factsMigration, /fine-mesh strainer lined with a coffee filter/);
  assert.match(factsMigration, /do not squeeze the grounds/);
  assert.match(factsMigration, /checklist_sort_order/);
  assert.match(checklist, /sortOrder\(a\) - sortOrder\(b\)/);
});
