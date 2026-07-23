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
  const route = read("app/api/atlas/tending/route.ts");

  assert.match(tending, /Tending/);
  assert.match(tending, /fetchTendingBoard/);
  assert.match(tending, /Harvest now/);
  assert.match(tending, /Unlock next/);
  assert.match(tending, /Protect harvests/);
  assert.match(tending, /Needs a look/);
  assert.match(tending, /Current gate/);
  assert.match(tending, /unlocks/);
  assert.match(tending, /remaining/);
  assert.match(tending, /tendingClock/);
  assert.match(tending, /tendingTaskHref/);
  assert.match(tending, /tendingBedHref/);
  assert.match(route, /tending_board_v1/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);

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
  assert.match(context, /fetchTendingTaskContext/);
  assert.match(context, /atlas-tending-task-context/);
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

test("The bed page is a harvest game board with one clickable current gate", () => {
  const bed = read("app/collections/weeding/[zoneKey]/[objectKey]/page.tsx");
  const bedRoute = read("app/api/atlas/tending/bed/route.ts");

  assert.match(bed, /fetchTendingBed/);
  assert.match(bed, /HARVEST TRACK/);
  assert.match(bed, /Harvest gates/);
  assert.match(bed, /gateSymbol/);
  assert.match(bed, /gate\.status === "current"/);
  assert.match(bed, /Current gate/);
  assert.match(bed, /unlocks/);
  assert.match(bed, /tendingTaskHref/);
  assert.match(bed, /<details className="atlas-tending-detail-drawer"/);
  assert.match(bed, /Bed details/);
  assert.match(bed, /Care engine/);
  assert.match(bedRoute, /tending_bed_v1/);
  assert.match(bedRoute, /requireAtlasApiAccess/);

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
