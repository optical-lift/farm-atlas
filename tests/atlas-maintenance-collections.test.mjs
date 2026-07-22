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

test("Weeding keeps the queue and hierarchy while using quiet state labels", () => {
  const weeding = read("app/collections/weeding/page.tsx");
  const route = read("app/api/atlas/weeding-cycle/route.ts");

  assert.match(weeding, /atlas-work-collection-hero/);
  assert.match(weeding, /atlas-overview-stat-grid/);
  assert.match(weeding, /atlas-weeding-cycle-stack/);
  assert.match(weeding, /title="Today"/);
  assert.match(weeding, /\? "Today"/);
  assert.match(weeding, /Field Row Queue/);
  assert.match(weeding, /Farm Weeding Order/);
  assert.match(weeding, /Recently Done \/ Resting/);
  assert.match(weeding, /Paused \/ Not Ready/);
  assert.match(weeding, /maintenanceAgeLabel/);
  assert.match(weeding, /fetchAtlasTaskCards/);
  assert.match(route, /weeding_cycle_v1/);
  assert.doesNotMatch(weeding, /Work Now/);
  assert.doesNotMatch(weeding, /Only released work appears here/);
  assert.doesNotMatch(weeding, /Finish the current batch/);
  assert.doesNotMatch(weeding, /The hierarchy—not the calendar/);
  assert.doesNotMatch(weeding, /queueExplanation/);
  assert.doesNotMatch(weeding, /hierarchyStepCopy/);
  assert.doesNotMatch(weeding, /Upcoming \(7 Days\)/);
  assert.doesNotMatch(weeding, /CanonicalMaintenanceCollectionView/);
});
