import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const day = readFileSync(new URL("../app/day/page.tsx", import.meta.url), "utf8");
const migration = readFileSync(new URL("../supabase/migrations/20260820231500_future_day_calendar_projection_contract.sql", import.meta.url), "utf8");

test("future browsing cannot manufacture overdue work", () => {
  assert.match(day, /const farmToday = todayIso\(\);/);
  assert.match(day, /if \(selectedDay !== farmToday\) return false;/);
  assert.match(day, /task\.due_date < farmToday/);
});

test("future Day reads queue continuations from the projection rather than today's open task", () => {
  assert.match(day, /projection\?\.sequence\.items/);
  assert.match(day, /item\.kind === "committed_task" && item\.automatic/);
  assert.match(day, /function FuturePlanCard/);
  assert.match(day, /onNodePress=\{isFutureDay \? undefined/);
});

test("future calendar cards are previews rather than completion surfaces", () => {
  assert.match(day, /!isFutureDay \? <DayTrailSummary/);
  assert.match(day, /atlas-day-future-plan-card/);
  assert.match(day, /pointer-events: none/);
});

test("database overlay has distinct historical live and future temporal modes", () => {
  assert.match(migration, /worker_day_temporal_mode_v1/);
  assert.match(migration, /if p_day > v_today then return 'future';/);
  assert.match(migration, /worker_day_future_projection_v1/);
  assert.match(migration, /Never run the live/);
});
