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

test("Weeding is replaced by the prepared Farm Care overview", () => {
  const farmCare = read("app/collections/weeding/page.tsx");
  const route = read("app/api/atlas/farm-care/route.ts");

  assert.match(farmCare, /Farm Care/);
  assert.match(farmCare, /summarySentence/);
  assert.match(farmCare, /stateCounts/);
  assert.match(farmCare, /observationCoverage/);
  assert.match(farmCare, /areasChanging/);
  assert.match(farmCare, /recentWins/);
  assert.match(farmCare, /highestConcernObject/);
  assert.match(farmCare, /strategySummary/);
  assert.match(farmCare, /care\.zones\.map/);
  assert.match(farmCare, /Unknown means the place needs a current look/);
  assert.match(route, /farm_care_summary_v1/);
  assert.match(route, /requireAtlasApiAccess/);

  assert.doesNotMatch(farmCare, /Field Row Queue/);
  assert.doesNotMatch(farmCare, /Farm Weeding Order/);
  assert.doesNotMatch(farmCare, /current tier/);
  assert.doesNotMatch(farmCare, /maintenanceAgeLabel/);
  assert.doesNotMatch(farmCare, /fetchAtlasTaskCards/);
  assert.doesNotMatch(farmCare, /postAtlasTaskTransition/);
  assert.doesNotMatch(route, /weeding_cycle_v1/);
});

test("Legacy queue completion remains in the task engine, outside Farm Care", () => {
  const farmCare = read("app/collections/weeding/page.tsx");
  const migration = read("supabase/migrations/20260722172500_allow_out_of_sequence_weeding_queue_completion.sql");

  assert.doesNotMatch(farmCare, /queueCompletion: "out_of_sequence"/);
  assert.doesNotMatch(farmCare, /item\.state === "queued"/);
  assert.match(migration, /qi\.state in \('active', 'queued'\)/);
  assert.match(migration, /if v_item\.state = 'active' then/);
  assert.match(migration, /completed_out_of_sequence/);
  assert.match(migration, /sync_task_release_queue_summary_v1/);
});
