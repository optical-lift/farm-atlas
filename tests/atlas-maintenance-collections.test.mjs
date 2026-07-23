import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Day keeps the deployed purple hero and collection layout", () => {
  const source = read("app/day/page.tsx");
  assert.match(source, /atlas-day-route-hero/);
  assert.match(source, /atlas-day-route-grid/);
  assert.match(source, /atlas-day-filter-pill/);
  assert.match(source, /WorkCollectionCard/);
  assert.match(source, /fetchAtlasTaskCards/);
  assert.doesNotMatch(source, /CanonicalScheduleView/);
});

test("Weeding remains a Tending destination but today's beds stay individual tasks", () => {
  const collections = read("lib/atlas/work-collections.ts");
  const portal = read("components/atlas/task-focus-tending-trail.tsx");
  const panel = read("components/atlas/tending-task-trail-panel.tsx");
  const layout = read("app/layout.tsx");
  const css = read("app/task-tending-trail.css");

  assert.match(collections, /atlasIsWeedingCollectionMember\(_task/);
  assert.match(collections, /released weeding task as the worker's ordinary canonical task/);
  assert.match(collections, /atlasBuildWeedingCollectionSummary/);
  assert.match(collections, /Task lineups intentionally do not replace today's exact weeding task/);
  assert.match(portal, /task-focus/);
  assert.match(portal, /isWeedingTask/);
  assert.match(portal, /object_key/);
  assert.match(portal, /TendingTaskTrailPanel/);
  assert.match(panel, /TendingMiniTrack/);
  assert.match(panel, /tendingClock/);
  assert.match(panel, /tendingStepsToHarvestLabel/);
  assert.match(panel, /Open bed board/);
  assert.match(layout, /<TaskFocusTendingTrail/);
  assert.match(layout, /task-tending-trail\.css/);
  assert.match(css, /atlas-task-tending-trail/);
});

test("Week and Month keep their deployed overview shapes", () => {
  const week = read("app/overview/week/page.tsx");
  const month = read("app/overview/month/page.tsx");

  assert.match(week, /atlas-overview-hero/);
  assert.match(week, /atlas-overview-stat-grid/);
  assert.match(week, /CollectionOverviewCard/);
  assert.match(week, /ZoneSection/);

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

test("Weeding is now the action-only Tending board", () => {
  const tending = read("app/collections/weeding/page.tsx");
  const track = read("components/atlas/tending-mini-track.tsx");
  const route = read("app/api/atlas/tending/route.ts");
  const layout = read("app/layout.tsx");
  const calmCss = read("app/tending-calm.css");
  const biteCss = read("app/tending-next-bite.css");
  const compactCss = read("app/tending-compact-track.css");

  assert.match(tending, /Tending/);
  assert.match(tending, /fetchTendingBoard/);
  assert.match(tending, /Harvest now/);
  assert.match(tending, /Unlock next/);
  assert.match(tending, /Protect harvests/);
  assert.match(tending, /Needs a look/);
  assert.match(tending, /Next step/);
  assert.match(tending, /taskTitle/);
  assert.match(tending, /unlocks/);
  assert.match(tending, /tendingDueLabel/);
  assert.match(tending, /tendingStepLabel/);
  assert.match(tending, /tendingStepsToHarvestLabel/);
  assert.match(tending, /tendingClock/);
  assert.match(tending, /tendingTaskHref/);
  assert.match(tending, /tendingBedHref/);
  assert.match(tending, /TendingMiniTrack/);
  assert.match(tending, /atlas-tending-page-title/);
  assert.match(track, /atlas-tending-mini-track/);
  assert.match(track, /gate-\$\{gate\.status\}/);
  assert.match(route, /tending_board_v1/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.match(layout, /tending-calm\.css/);
  assert.match(layout, /tending-next-bite\.css/);
  assert.match(layout, /tending-compact-track\.css/);
  assert.match(calmCss, /--tending-sage/);
  assert.match(calmCss, /--tending-mauve/);
  assert.match(calmCss, /--tending-parchment/);
  assert.match(biteCss, /background: rgba\(255, 254, 250/);
  assert.match(biteCss, /atlas-tending-step-meta/);
  assert.match(compactCss, /atlas-tending-mini-track/);
  assert.match(compactCss, /gate-current i/);

  assert.doesNotMatch(tending, /atlas-overview-hero atlas-tending-hero/);
  assert.doesNotMatch(tending, /Holding/);
  assert.doesNotMatch(tending, /Resting/);
  assert.doesNotMatch(tending, /Suppressed/);
  assert.doesNotMatch(tending, /Settled/);
  assert.doesNotMatch(tending, /Farm condition/);
  assert.doesNotMatch(tending, /summarySentence/);
  assert.doesNotMatch(tending, /observationCoverage/);
  assert.doesNotMatch(tending, /fetchFarmCareSummary/);
  assert.doesNotMatch(tending, /fetchAtlasTaskCards/);
  assert.doesNotMatch(route, /service_role|createServiceClient/i);
});

test("Tending opens the exact canonical task with the familiar result controls", () => {
  const client = read("lib/atlas/tending-client.ts");
  const context = read("components/atlas/tending-task-context.tsx");
  const taskRoute = read("app/api/atlas/tending/task-context/route.ts");
  const taskPage = read("app/task/page.tsx");
  const layout = read("app/layout.tsx");

  assert.match(client, /taskId: track\.releasedTaskId/);
  assert.match(client, /from: "tending"/);
  assert.match(client, /bedKey: track\.bedKey/);
  assert.match(client, /returnTo: boardPath/);
  assert.match(client, /tendingDueLabel/);
  assert.match(client, /tendingStepLabel/);
  assert.match(context, /fetchTendingTaskContext/);
  assert.match(context, /atlas-tending-task-context/);
  assert.match(context, /<dt>Due<\/dt>/);
  assert.match(context, /tendingStepsToHarvestLabel/);
  assert.match(context, /Open bed board/);
  assert.match(taskRoute, /tending_task_context_v2/);
  assert.match(taskRoute, /p_task_id: taskId/);
  assert.match(taskRoute, /p_object_key: objectKey/);
  assert.match(layout, /<TendingTaskContext/);

  assert.match(taskPage, /saving === "done"/);
  assert.match(taskPage, /Unfinished/);
  assert.match(taskPage, /Partly done/);
  assert.match(taskPage, /Blocked/);
  assert.match(taskPage, /postAtlasTaskTransition/);
  assert.match(taskPage, /returnTo/);
  assert.doesNotMatch(taskRoute, /service_role|createServiceClient/i);
});

test("The bed page is a dated harvest path with one clickable next step", () => {
  const bed = read("app/collections/weeding/[zoneKey]/[objectKey]/page.tsx");
  const bedRoute = read("app/api/atlas/tending/bed/route.ts");
  const migration = read("supabase/migrations/20260723154500_tending_next_bite_gates.sql");

  assert.match(bed, /fetchTendingBed/);
  assert.match(bed, /HARVEST TRACK/);
  assert.match(bed, /Path to harvest/);
  assert.match(bed, /gateSymbol/);
  assert.match(bed, /gate\.status === "current"/);
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
