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

test("Mowing and Weeding keep the deployed collection boxes and data lines", () => {
  const mowing = read("app/collections/mowing/page.tsx");
  const weeding = read("app/collections/weeding/page.tsx");

  for (const source of [mowing, weeding]) {
    assert.match(source, /atlas-work-collection-hero/);
    assert.match(source, /atlas-overview-stat-grid/);
    assert.match(source, /atlas-work-collection-list/);
    assert.match(source, /Recently Done \/ Resting/);
    assert.match(source, /Not Ready/);
    assert.match(source, /fetchAtlasTaskCards/);
    assert.doesNotMatch(source, /CanonicalMaintenanceCollectionView/);
  }

  assert.match(mowing, /Upcoming/);
  assert.match(weeding, /Upcoming \(7 Days\)/);
  assert.match(weeding, /maintenanceAgeLabel/);
});
