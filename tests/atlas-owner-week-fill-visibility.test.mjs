import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const weekPage = await readFile(new URL("../app/overview/week/page.tsx", import.meta.url), "utf8");
const weekProjectionRoute = await readFile(new URL("../app/api/atlas/owner-week-projection/route.ts", import.meta.url), "utf8");

test("Owner Week reads the farm-hand paid-work projection instead of showing only hard-date cards", () => {
  assert.match(weekPage, /owner-week-projection\?start=/);
  assert.match(weekPage, /Atlas fill plan/);
  assert.match(weekPage, /Planned fill/);
  assert.match(weekPage, /Finish Elm/);
  assert.match(weekPage, /projectedItems/);
  assert.match(weekPage, /projectedPaidMinutes/);
});

test("week fill remains visibly distinct from hard-date calendar truth", () => {
  assert.match(weekPage, /These are the additional paid jobs Atlas is reserving for this day/);
  assert.match(weekPage, /distinct from hard-date calendar commitments until released/);
  assert.match(weekPage, /data-week-projected-work/);
  assert.match(weekPage, /borderStyle: "dashed"/);
});

test("Owner week projection only exposes non-task fill items for future farm-hand planning", () => {
  assert.match(weekProjectionRoute, /effective\.farmRole !== "farm_hand"/);
  assert.match(weekProjectionRoute, /const firstFuture = addDaysIso\(today, 1\)/);
  assert.match(weekProjectionRoute, /fillItems = day\.items\.filter\(\(item\) => item\.sourceKind !== "task"\)/);
  assert.match(weekProjectionRoute, /paidGapMinutes/);
  assert.match(weekProjectionRoute, /paidTargetMinutes/);
});
