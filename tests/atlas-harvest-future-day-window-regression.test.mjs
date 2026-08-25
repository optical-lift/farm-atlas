import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const weeklyHarvestRoute = readFileSync(new URL("../app/api/atlas/weekly-harvest/route.ts", import.meta.url), "utf8");
const dayPage = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");

test("Weekly Harvest accepts a canonical task UUID", () => {
  const match = weeklyHarvestRoute.match(/const UUID_PATTERN = \/(.+)\/i;/);
  assert.ok(match, "Weekly Harvest must declare its UUID validator");
  const pattern = new RegExp(match[1], "i");
  assert.equal(pattern.test("9ecfc549-0898-4544-8d3a-0a987de3184b"), true);
  assert.equal(pattern.test("not-a-task-id"), false);
});

test("future automatic work joins the same day-window ordering as real tasks", () => {
  assert.match(dayPage, /sequenceOrder: number;/);
  assert.match(dayPage, /sequenceOrder: item\.sequenceOrder/);
  assert.match(dayPage, /function windowedTimeline\(groups: RenderTimelineGroup\[], futureItems: FutureProjectionItem\[] = \[]\)/);
  assert.match(dayPage, /order: resolvedWorkOrderNumber\(task, dateIso, partnerPlan\)/);
  assert.match(dayPage, /order: item\.sequenceOrder/);
  assert.match(dayPage, /left\.order - right\.order/);
  assert.match(dayPage, /windowedTimeline\(visibleTimelineGroups, isFutureDay \? futureAutomaticItems : \[]\)/);
});
