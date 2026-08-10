import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const foundation = read("supabase/migrations/20260804070500_thursday_morning_execution_checklist_v1.sql");
const clusters = read("supabase/migrations/20260804074000_thursday_morning_checklist_clusters_v2.sql");
const split = read("supabase/migrations/20260804074500_split_thursday_morning_into_four_tasks_v2.sql");
const capacityOrder = read("supabase/migrations/20260804075000_thursday_morning_cluster_capacity_order_v2.sql");
const canonical = read("components/atlas/canonical-assigned-task-detail.tsx");
const detail = read("components/atlas/execution-checklist-task-detail.tsx");
const shell = read("components/atlas/assigned-task-execution-shell.tsx");
const execution = read("lib/atlas/task-execution.ts");
const route = read("app/api/atlas/task-execution-checklist/route.ts");

test("Thursday morning preparation opens as four themed tasks with visible checklists", () => {
  assert.match(canonical, /ExecutionChecklistTaskDetail/);
  assert.match(canonical, /execution_checklist_template_key/);
  assert.match(detail, /AssignedTaskExecutionShell/);
  assert.match(detail, /methodInstrument=\{methodInstrument\}/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(detail, /atlas-execution-checklist__section/);
  assert.match(detail, /execution_checklist_kicker/);
  assert.match(detail, /execution_checklist_title/);
  assert.match(execution, /execution_checklist_completion_label/);
  assert.doesNotMatch(detail, /TaskDominionTrail/);
  assert.doesNotMatch(detail, /instruction="Prepare Elm for Thursday Morning"/);
  assert.doesNotMatch(detail, /Wednesday closing round/);
  assert.doesNotMatch(detail, /TaskChildChecklist/);
  assert.doesNotMatch(detail, /atlas-task-procedure/);
  assert.doesNotMatch(detail, />Steps</);
});

test("the four task identities match the owner's requested work clusters", () => {
  for (const title of [
    "Close the Farm Work Areas",
    "Prepare Coffee + Water",
    "Ready the Guest Rooms",
    "Take Out the Kitchen Trash",
  ]) {
    assert.ok(clusters.includes(`'${title}'`), `${title} is a canonical cluster title`);
  }

  for (const series of [
    "community_thursday_wednesday_outdoor",
    "community_thursday_wednesday_coffee_water",
    "community_thursday_wednesday_rooms",
    "community_thursday_wednesday_trash",
  ]) {
    assert.ok(clusters.includes(`'${series}'`), `${series} is a distinct recurring series`);
  }

  assert.match(clusters, /maximum_active_instances = 1/);
  assert.match(split, /supersededBy','thursday_morning_clusters_v2/);
});

test("each task keeps a small, themed checklist instead of the former sixteen-line card", () => {
  assert.match(clusters, /Store farm tools in their proper places/);
  assert.match(clusters, /Tidy the farm work areas/);
  assert.match(clusters, /Wash and stage the harvest buckets/);
  assert.match(clusters, /Make cold brew and refrigerate it overnight/);
  assert.match(clusters, /Restock and reset the coffee bar/);
  assert.match(clusters, /Refill the water dispenser/);
  assert.match(clusters, /Clean and stock the bathroom/);
  assert.match(clusters, /Clear and reset the Library until it is visibly guest-ready/);
  assert.match(clusters, /Clear and reset the meeting room until it is visibly guest-ready/);
  assert.match(clusters, /Take out the kitchen trash/);
  assert.doesNotMatch(clusters, /guest-area trash/i);
  assert.doesNotMatch(clusters, /Lounge/);
  assert.doesNotMatch(clusters, /Sweep porches/);
  assert.doesNotMatch(clusters, /Pick up sticks/);
  assert.doesNotMatch(clusters, /temperature/i);
  assert.doesNotMatch(clusters, /animal check/i);
});

test("the split preserves prior checks as history while retired v1 lines stop blocking work", () => {
  assert.match(foundation, /task_execution_checklist_events/);
  assert.match(split, /thursday_morning_v1_check_state/);
  assert.match(split, /'retired',true/);
  assert.match(split, /preservedPriorCheck/);
  assert.match(clusters, /metadata ->> 'retired'/);
  assert.match(clusters, /Complete every required checklist item before finishing this task/);
  assert.match(detail, /checklist\?\.ready !== true/);
  assert.match(detail, /completion_source: outcome === "done" \? "execution_checklist" : "task_card"/);
});

test("current and future Thursday mornings expand to one occurrence per cluster", () => {
  assert.match(clusters, /ensure_thursday_morning_cluster_occurrences_v2/);
  assert.match(clusters, /array\['outdoor','coffee_water','trash'\]/);
  assert.match(clusters, /community_thursday_wednesday_rooms:/);
  assert.match(split, /community_thursday_wednesday_rooms:/);
  assert.match(clusters, /paid_event_scope',false/);
});

test("private capacity remains 120 minutes split across the four small cards", () => {
  assert.match(clusters, /community_thursday_morning_outdoor_v2',35,'moderate'/);
  assert.match(clusters, /community_thursday_morning_coffee_water_v2',25,'light'/);
  assert.match(clusters, /community_thursday_morning_rooms_v2',50,'moderate'/);
  assert.match(clusters, /community_thursday_morning_trash_v2',10,'light'/);
  assert.match(capacityOrder, /zzzz_seed_task_execution_checklist_v2/);
  assert.doesNotMatch(detail, /expected_active_minutes/);
  assert.doesNotMatch(detail, /120/);
});

test("the checklist API remains role-aware and supports owner operator mode", () => {
  assert.match(route, /task-execution-checklist-v1/);
  assert.match(route, /effectiveOperatorMembershipId/);
  assert.match(route, /task_execution_checklist_v1/);
  assert.match(route, /record_task_execution_check_v1/);
});
