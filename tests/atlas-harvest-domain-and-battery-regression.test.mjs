import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const harvestMigration = readFileSync(new URL("../supabase/migrations/20260825142612_harvest_use_tag_split_and_food_tuesday_v1.sql", import.meta.url), "utf8");
const batteryMigration = readFileSync(new URL("../supabase/migrations/20260825143219_rechargeable_battery_worker_day_choreography_v2.sql", import.meta.url), "utf8");
const rolloverMigration = readFileSync(new URL("../supabase/migrations/20260825143310_calendar_rollover_battery_session_reconcile_v1.sql", import.meta.url), "utf8");
const foodRoute = readFileSync(new URL("../app/api/atlas/weekly-food-harvest/route.ts", import.meta.url), "utf8");
const foodCard = readFileSync(new URL("../components/atlas/weekly-food-harvest-task-detail.tsx", import.meta.url), "utf8");
const dispatcher = readFileSync(new URL("../components/atlas/canonical-assigned-task-detail.tsx", import.meta.url), "utf8");

test("Thursday Harvest is cut-flower-only and exhausted crops leave the card", () => {
  assert.match(harvestMigration, /metadata->'use_tags'.*\?'cut_flower'/s);
  assert.match(harvestMigration, /wr\.result_kind<>'crop_exhausted'/);
  assert.match(harvestMigration, /'cropExhaustedLeavesCard',true/);
});

test("Tuesday Food Harvest owns direct crop outcomes without flower inventory", () => {
  assert.match(harvestMigration, /metadata->'use_tags'.*\?'food'/s);
  assert.match(harvestMigration, /anna_food_harvest_tuesday_weekly/);
  assert.match(harvestMigration, /weekly_food_harvest_round_v1/);
  assert.match(harvestMigration, /'flowerInventoryEffect','none'/);
  assert.match(foodRoute, /food_picked/);
  assert.match(foodRoute, /not_ready/);
  assert.match(foodRoute, /crop_exhausted/);
  assert.match(foodCard, /data-food-direct-outcomes="true"/);
  assert.match(foodCard, /onClick=\{\(\) => void record\(row, item\.value\)\}/);
  assert.match(foodCard, /Picked/);
  assert.match(foodCard, /Not ready/);
  assert.match(foodCard, /Crop exhausted/);
  assert.doesNotMatch(foodCard, /activeCycleId/);
  assert.doesNotMatch(foodCard, /aria-expanded/);
  assert.doesNotMatch(foodCard, /Choose an outcome/);
  assert.match(dispatcher, /WeeklyFoodHarvestTaskDetail/);
});

test("battery mowing is morning recharge afternoon mowing evening and rollover pushes newer work", () => {
  assert.match(batteryMigration, /'worker_day_session_capacity',2/);
  assert.match(batteryMigration, /'recharge_required_between_sessions',true/);
  assert.match(batteryMigration, /'work_order_anchor','afternoon'/);
  assert.match(batteryMigration, /case when v_rank=1 then 'morning' else 'evening' end/);
  assert.match(batteryMigration, /'thirdSessionForbidden',true/);
  assert.match(batteryMigration, /'overdueWorkPushesNewerWork',true/);
  assert.match(rolloverMigration, /reconcile_worker_day_battery_sessions_v1/);
});
