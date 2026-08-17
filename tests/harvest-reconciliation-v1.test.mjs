import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260815144000_harvest_flower_reconciliation_v1.sql");
const route = read("app/api/atlas/flower-commercial-score/route.ts");
const scoreSection = read("app/harvest/HarvestCommercialScoreSection.tsx");
const harvested = read("app/harvest/HarvestedOutputSection.tsx");

test("Ready retail valuation is snapshotted from an append-only dated price book", () => {
  assert.match(migration, /create table atlas\.flower_product_price_book/i);
  assert.match(migration, /flower_product_price_book_append_only_v1/i);
  assert.match(migration, /add column retail_unit_value/i);
  assert.match(migration, /stamp_flower_ready_retail_value_v1/i);
  assert.match(migration, /flower_ready_inventory_lots_00_stamp_retail_v1/i);
  assert.match(migration, /'posy'::text,'posy'::text,10\.00::numeric/i);
  assert.match(migration, /'bouquet'::text,'bouquet'::text,25\.00::numeric/i);
  assert.match(migration, /'lobby_arrangement'::text,'arrangement'::text,15\.00::numeric/i);
});

test("sell-through derives from Ready birth truth, active claims and explicit dispositions", () => {
  assert.match(migration, /create view atlas\.flower_ready_inventory_position_v1/i);
  assert.match(migration, /security_invoker=true/i);
  assert.match(migration, /not exists[\s\S]*flower_sale_order_cancellation_events/i);
  assert.match(migration, /flower_ready_inventory_disposition_events/i);
  assert.match(migration, /active_claimed_retail_value/i);
  assert.match(migration, /create view atlas\.flower_commercial_farm_score_v1/i);
  assert.match(migration, /100\*ready\.priced_claimed_retail_value\/ready\.priced_prepared_retail_value/i);
});

test("revenue becomes realized only through fulfillment", () => {
  assert.match(migration, /sum\(sale\.subtotal_amount\) filter \(where fulfillment\.id is not null\)/i);
  assert.match(migration, /realized_revenue/i);
  assert.match(migration, /realized_total_receipts/i);
  assert.match(migration, /realized_product_revenue/i);
});

test("unpriced Ready output withholds the sell-through score instead of inventing valuation", () => {
  assert.match(migration, /unpriced_ready_lot_count/i);
  assert.match(migration, /when coalesce\(ready\.unpriced_ready_lot_count,0\)>0 then null/i);
  assert.match(scoreSection, /Sell-through is withheld because/);
});

test("Production evidence preserves attribution boundaries for mixed and unlinked harvests", () => {
  assert.match(migration, /create view atlas\.flower_preparation_commercial_evidence_v1/i);
  assert.match(migration, /partial_linkage/);
  assert.match(migration, /mixed_production_lots/);
  assert.match(migration, /create view atlas\.flower_harvest_production_evidence_v1/i);
  assert.match(migration, /mixed_batch_unallocated/);
  assert.match(migration, /direct_single_observation/);
  assert.match(migration, /directly_attributable_realized_product_revenue/);
  assert.doesNotMatch(migration, /create table atlas\.owner_obligations/i);
  assert.doesNotMatch(migration, /create table atlas\.operational_escalations/i);
});

test("Harvest exposes the derived score without moving commercial truth into the client", () => {
  assert.match(route, /flower_commercial_farm_score_v1/);
  assert.match(route, /getAtlasSession/);
  assert.match(route, /private, no-store/);
  assert.match(scoreSection, /What Harvest became/);
  assert.match(scoreSection, /Revenue becomes realized only after actual handoff/);
  assert.match(harvested, /<HarvestCommercialScoreSection \/>/);
});
