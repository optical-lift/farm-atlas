import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

const choreography = read("lib/atlas/day-choreography-server.ts");
const sequence = read("lib/atlas/day-sequence.ts");
const layout = read("lib/atlas/clock-layout.ts");
const migration = read("supabase/migrations/20260813191900_clock_planned_duration_v1.sql");

test("planned Clock duration is choreography truth rather than task truth", () => {
  assert.match(choreography, /plannedDurationMinutes: number \| null/);
  assert.match(choreography, /plannedDurationMinutes: nullablePositiveInteger\(row\.plannedDurationMinutes\)/);
  assert.match(sequence, /plannedDurationMinutes\?: number \| null/);
  assert.match(sequence, /plannedDurationMinutes: minutes\(placement\?\.plannedDurationMinutes\)/);
  assert.match(migration, /worker_day_task_placements\.planned_duration_minutes/);
  assert.match(migration, /separate from task due-date truth/);
});

test("Clock layout prefers explicit planned duration and keeps private estimates Owner-only", () => {
  assert.match(layout, /item\.plannedDurationMinutes && item\.plannedDurationMinutes > 0/);
  assert.match(layout, /source: "planned"/);
  assert.match(layout, /allowPrivateEstimate && item\.estimatedMinutes/);
  assert.match(layout, /source: "estimate"/);
  assert.match(layout, /source: "none"/);
});

test("Clock layout detects overlap only when real spans exist", () => {
  assert.match(layout, /clockConflictTaskIds/);
  assert.match(layout, /if \(!left\.span\.minutes\) continue/);
  assert.match(layout, /if \(!right\.span\.minutes\) continue/);
  assert.match(layout, /right\.startMinute < left\.endMinute && right\.endMinute > left\.startMinute/);
});

test("Clock NEXT follows an active timed block, then future timed work, then unplaced work", () => {
  assert.match(layout, /chooseClockNextTask/);
  assert.match(layout, /range\.startMinute <= nowMinute/);
  assert.match(layout, /range\.endMinute > nowMinute/);
  assert.match(layout, /range\.startMinute >= nowMinute/);
  assert.match(layout, /openCommitted\.find\(\(item\) => !item\.plannedStartAt\)/);
});
