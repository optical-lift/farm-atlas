import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20260812204500_thursdays_retail_operation_grammar_v1.sql", import.meta.url),
  "utf8",
);

test("Thursday retail motions are reusable work definitions instead of Set-task prose", () => {
  for (const key of [
    "thursdays_retail_display_bouquet_flowers",
    "thursdays_retail_stock_wrapping_station",
    "thursdays_retail_stock_bouquet_tools",
    "thursdays_retail_stage_finished_pickup",
    "thursdays_host_stock_cold_brew_station",
  ]) assert.match(migration, new RegExp(key));
  assert.match(migration, /recurring_motion',true/);
  assert.match(migration, /schedule_owner','event_instance'/);
});

test("worker vocabulary follows the real retail and hospitality motion", () => {
  assert.match(migration, /Display bouquet flowers for guests/);
  assert.match(migration, /Stock bouquet wrapping station/);
  assert.match(migration, /Stock bouquet tool station/);
  assert.match(migration, /Stage finished bouquets for pickup/);
  assert.match(migration, /Stock cold-brew drink station/);
  assert.doesNotMatch(migration, /Set wrapping station/);
  assert.doesNotMatch(migration, /Set snips \+ stripping station/);
});

test("each repeated motion has a useful post-state", () => {
  assert.match(migration, /Conditioned flower buckets are displayed and ready for guests to choose from/);
  assert.match(migration, /Wrapping supplies are stocked and ready to finish and name guest bouquets/);
  assert.match(migration, /Snips and the stripping bucket are stocked and ready for bouquet building/);
  assert.match(migration, /The cold-brew station is stocked and ready to serve guests/);
});
