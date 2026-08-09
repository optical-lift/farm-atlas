import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

test("Anna gets one automatic serial Weed Card per available workday", () => {
  const route = read("app/api/atlas/automatic-day-work/route.ts");
  const migration = read("supabase/migrations/20260809174600_anna_daily_weed_slot_automatic_v1.sql");

  assert.match(route, /anna_weeding_rotation/);
  assert.match(route, /nextWorkerDay/);
  assert.match(route, /Automatic daily Weed Card/);
  assert.match(route, /If the prior workday's Weed Card is unfinished/);
  assert.match(migration, /exactly_one_weed_card_per_workday/);
  assert.match(migration, /'release_timing','next_workday'/);
  assert.match(migration, /'owner_schedule_approval_required',false/);
});

test("mowing occupies one automatic evening rhythm slot without owner tapping", () => {
  const route = read("app/api/atlas/automatic-day-work/route.ts");
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");

  assert.match(route, /realMowOnRequestedDay/);
  assert.match(route, /Automatic mowing slot/);
  assert.match(route, /dayWindow: "evening"/);
  assert.match(builder, /\/api\/atlas\/automatic-day-work\?date=/);
  assert.match(builder, /AutomaticRow/);
  assert.match(builder, /data-owner-schedule-automatic/);
  assert.match(builder, /candidate\.sourceKind === "queue" \|\| candidate\.sourceKind === "rhythm"/);
});

test("sowing is evening work everywhere the day timeline infers placement", () => {
  const workOrder = read("lib/atlas/work-order.ts");
  const migration = read("supabase/migrations/20260809174500_anna_sowing_evening_window_v1.sql");

  assert.match(workOrder, /route === "seed"[^\n]+return "evening"/);
  assert.match(migration, /'work_order_anchor','evening'/);
  assert.match(migration, /'work_window_key','evening'/);
});

test("synthetic daypart labels yield to the real task-feed daypart marker", () => {
  const builder = read("components/atlas/owner-day-schedule-builder.tsx");

  assert.match(builder, /function realMarker/);
  assert.match(builder, /ownerScheduleSyntheticWindow !== "true"/);
  assert.match(builder, /synthetic\.forEach\(\(marker\) => marker\.remove\(\)\)/);
  assert.match(builder, /detail\.textContent = "planned work"/);
});
