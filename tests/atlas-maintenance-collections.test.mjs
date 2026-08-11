import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day keeps canonical maintenance jobs in the mixed timeline while the compact drawer stays recovery-only", () => {
  const source = read("app/day/page.tsx");
  const routeCss = read("app/day-route-v1.css");
  const recoveryCss = read("app/day-overdue-quiet.css");
  const adapter = read("lib/atlas/day-route.ts");

  assert.match(source, /atlas-day-command-header/);
  assert.match(source, /atlas-day-recovery-overview/);
  assert.match(source, /atlas-day-recovery-chip-list/);
  assert.match(source, /atlas-day-filter-pill/);
  assert.match(source, /atlas-day-route-spine/);
  assert.match(source, /atlas-day-mixed-timeline/);
  assert.match(source, /windowedTimeline\(visibleTimelineGroups\)/);
  assert.match(source, /relativeWorkerTimelineGroups/);
  assert.match(source, /fetchAtlasTaskCards/);
  assert.match(source, /mixedOpenTasks/);
  assert.match(source, /atlasRouteKeyForTask/);
  assert.doesNotMatch(source, /WorkCollectionCard/);
  assert.doesNotMatch(source, /atlas-day-route-grid/);
  assert.match(adapter, /atlasDayRouteState/);
  assert.match(routeCss, /atlas-day-view-toggle/);
  assert.match(recoveryCss, /atlas-day-window-marker/);
  assert.doesNotMatch(source, /atlas-day-route-hero/);
  assert.doesNotMatch(source, /CanonicalScheduleView/);
});

test("Weeding remains a Tending destination while every released move is a canonical task", () => {
  const collections = read("lib/atlas/work-collections.ts");
  const timeline = read("components/atlas/tending/TendingTaskTimeline.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");
  const brief = read("components/atlas/task-execution-brief.tsx");
  const layout = read("app/layout.tsx");
  const css = read("app/tending-task-timeline.css");

  assert.match(collections, /atlasIsWeedingCollectionMember\(_task/);
  assert.match(collections, /released weeding task as the worker's ordinary canonical task/);
  assert.match(collections, /atlasBuildWeedingCollectionSummary/);
  assert.match(collections, /Task lineups intentionally do not replace today's exact weeding task/);
  assert.match(timeline, /atlas-day-route-spine/);
  assert.match(timeline, /atlas-day-task-entry/);
  assert.match(timeline, /atlas-day-task-card/);
  assert.match(timeline, /tendingTaskHref\(track, returnTo\)/);
  assert.match(shell, /<TaskExecutionBrief task=\{task\} assembly=\{assembly\} \/>/);
  assert.match(brief, /TaskMoveSpine/);
  assert.doesNotMatch(shell, /TaskDominionTrail|fetchTendingTaskContext/);
  assert.match(layout, /tending-task-timeline\.css/);
  assert.doesNotMatch(layout, /TendingTaskContext/);
  assert.match(css, /same Day\/Week/);
});

test("Week is a daily timeline while Month keeps the aggregate overview", () => {
  const week = read("app/overview/week/page.tsx");
  const weekCss = read("app/week-route-v1.css");
  const month = read("app/overview/month/page.tsx");
  const layout = read("app/layout.tsx");

  assert.match(week, /atlas-week-route-header/);
  assert.match(week, /atlas-week-day-rail/);
  assert.match(week, /atlas-week-day-list/);
  assert.match(week, /WeekDaySection/);
  assert.match(week, /WeekTaskCard/);
  assert.match(week, /Timeline/);
  assert.match(week, /Zone/);
  assert.match(week, /Carryover needs placement/);
  assert.doesNotMatch(week, /atlas-overview-stat-grid/);
  assert.doesNotMatch(week, /CollectionOverviewCard/);
  assert.doesNotMatch(week, /ZoneSection/);
  assert.match(weekCss, /atlas-week-day-section/);
  assert.match(weekCss, /atlas-week-route-spine/);
  assert.match(layout, /week-route-v1\.css/);

  assert.match(month, /atlas-overview-month-hero/);
  assert.match(month, /atlas-overview-month-progress-row/);
  assert.match(month, /CollectionOverviewCard/);
  assert.match(month, /ZoneSection/);

  assert.doesNotMatch(week, /CanonicalScheduleView/);
  assert.doesNotMatch(month, /CanonicalScheduleView/);
});

test("Mowing keeps the deployed collection boxes and data lines", () => {
  const mowing = read("app/collections/mowing/page.tsx");

  assert.match(mowing, /atlas-work-collection-hero/);
  assert.match(mowing, /atlas-overview-stat-grid/);
  assert.match(mowing, /atlas-work-collection-list/);
  assert.match(mowing, /Upcoming/);
  assert.match(mowing, /Recently Done \/ Resting/);
  assert.match(mowing, /Not Ready/);
  assert.match(mowing, /fetchAtlasTaskCards/);
  assert.doesNotMatch(mowing, /CanonicalMaintenanceCollectionView/);
});

test("Tending overview is a released-task collection rather than a second work interface", () => {
  const tending = read("app/collections/weeding/page.tsx");
  const timeline = read("components/atlas/tending/TendingTaskTimeline.tsx");
  const route = read("app/api/atlas/tending/route.ts");
  const layout = read("app/layout.tsx");
  const css = read("app/tending-task-timeline.css");

  assert.match(tending, /TendingTaskTimeline/);
  assert.match(tending, /fetchTendingBoard/);
  assert.match(tending, /tasks.*released/);
  assert.match(timeline, /Harvest now/);
  assert.match(timeline, /Unlock next/);
  assert.match(timeline, /Protect harvests/);
  assert.match(timeline, /Needs a look/);
  assert.match(timeline, /track\.releasedTaskId && track\.currentGate/);
  assert.match(timeline, /Current ·/);
  assert.match(timeline, /tendingDueLabel/);
  assert.match(timeline, /tendingStepLabel/);
  assert.match(timeline, /tendingStepsToHarvestLabel/);
  assert.match(timeline, /tendingClock/);
  assert.match(timeline, /tendingTaskHref/);
  assert.match(timeline, /tendingBedHref/);
  assert.match(timeline, /atlas-day-route-spine/);
  assert.match(timeline, /atlas-day-task-node/);
  assert.match(timeline, /atlas-day-task-card/);
  assert.match(route, /tending_board_v1/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(layout, /tending-task-timeline\.css/);
  assert.match(css, /canonical Atlas tasks/);

  assert.doesNotMatch(tending, /TendingMiniTrack/);
  assert.doesNotMatch(tending, /atlas-tending-current-gate/);
  assert.doesNotMatch(tending, /fetchAtlasTaskCards/);
  assert.doesNotMatch(route, /service_role|createServiceClient/i);
});

test("Tending opens universal task focus while crop context stays in canonical farm state and Task Move", () => {
  const client = read("lib/atlas/tending-client.ts");
  const timeline = read("components/atlas/tending/TendingTaskTimeline.tsx");
  const taskRoute = read("app/api/atlas/tending/task-context/route.ts");
  const taskFocus = read("app/task-focus/[taskId]/page.tsx");
  const shell = read("components/atlas/assigned-task-execution-shell.tsx");

  assert.match(client, /\/task-focus\/\$\{encodeURIComponent\(track\.releasedTaskId\)\}/);
  assert.match(client, /returnTo=/);
  assert.match(timeline, /tendingTaskHref\(track, returnTo\)/);
  assert.match(taskRoute, /tending_task_context_v2/);
  assert.match(taskRoute, /p_task_id: taskId/);
  assert.match(taskRoute, /p_object_key: objectKey/);
  assert.match(taskFocus, /CanonicalAssignedTaskDetail/);
  assert.match(shell, /\/api\/atlas\/task-move\?taskId=/);
  assert.doesNotMatch(shell, /TaskDominionTrail/);

  assert.match(taskRoute, /requireAtlasApiAccess/);
  assert.doesNotMatch(taskRoute, /service_role|createServiceClient/i);
});

test("The bed page is a dated harvest path with one clickable current move", () => {
  const bed = read("app/collections/weeding/[zoneKey]/[objectKey]/page.tsx");
  const bedRoute = read("app/api/atlas/tending/bed/route.ts");
  const renderer = read("components/atlas/trail/AtlasTrail.tsx");
  const migration = read("supabase/migrations/20260723154500_tending_next_bite_gates.sql");

  assert.match(bed, /fetchTendingBed/);
  assert.match(bed, /HARVEST TRACK/);
  assert.match(bed, /Path to harvest/);
  assert.match(bed, /AtlasTrail/);
  assert.match(bed, /atlasTrailFromTendingTrack\(bed, taskHref\)/);
  assert.match(renderer, /node\.status === "current" \|\| node\.status === "blocked"/);
  assert.match(bed, /tendingDueLabel/);
  assert.match(bed, /tendingStepLabel/);
  assert.match(bed, /taskTitle/);
  assert.match(bed, /unlocks/);
  assert.match(bed, /tendingTaskHref/);
  assert.match(bed, /<details className="atlas-tending-detail-drawer"/);
  assert.match(bed, /Bed details/);
  assert.match(bed, /Care engine/);
  assert.match(bedRoute, /tending_bed_v1/);
  assert.match(bedRoute, /requireAtlasApiAccess/);

  assert.match(migration, /tending_profile_gates_v1/);
  assert.match(migration, /"pinch","label":"Pinch"/);
  assert.match(migration, /stepsToHarvestCount/);
  assert.match(migration, /currentStepNumber/);
  assert.doesNotMatch(migration, /insert into atlas\.tasks/i);
  assert.doesNotMatch(bed, /gateSymbol|bed\.gates\.map/);
  assert.doesNotMatch(bed, /Farm Care object hero/);
  assert.doesNotMatch(bed, /Prepared, not released/);
  assert.doesNotMatch(bed, /No executable task is currently released/);
  assert.doesNotMatch(bedRoute, /service_role|createServiceClient/i);
});

test("Care remains the engine and management corrections stay restricted", () => {
  const bed = read("app/collections/weeding/[zoneKey]/[objectKey]/page.tsx");
  const careRoute = read("app/api/atlas/farm-care/object/route.ts");

  assert.match(bed, /fetchFarmCareObject/);
  assert.match(bed, /Care engine/);
  assert.match(bed, /mayCorrect/);
  assert.match(bed, /Management controls/);
  assert.match(careRoute, /allowedRoles: \["owner", "manager"\]/);
  assert.match(careRoute, /record_care_observation_v1/);
  assert.match(careRoute, /set_object_care_strategy_v1/);
});

test("Legacy queue completion remains in the task engine, outside Tending", () => {
  const tending = read("app/collections/weeding/page.tsx");
  const migration = read("supabase/migrations/20260722172500_allow_out_of_sequence_weeding_queue_completion.sql");

  assert.doesNotMatch(tending, /queueCompletion: "out_of_sequence"/);
  assert.doesNotMatch(tending, /item\.state === "queued"/);
  assert.match(migration, /qi\.state in \('active', 'queued'\)/);
  assert.match(migration, /if v_item\.state = 'active' then/);
  assert.match(migration, /completed_out_of_sequence/);
  assert.match(migration, /sync_task_release_queue_summary_v1/);
});
