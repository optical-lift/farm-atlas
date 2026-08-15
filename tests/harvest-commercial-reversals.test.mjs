import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const migration = read("supabase/migrations/20260815143200_harvest_flower_commercial_reversals_v1.sql");
const fulfillmentLane = read("supabase/migrations/20260815143250_harvest_flower_fulfillment_required_lane_v1.sql");
const registry = read("supabase/migrations/20260815143300_harvest_flower_commercial_reversals_rpc_registry_v1.sql");

test("commercial reversals are append-only facts, not mutation of sale or Ready birth truth", () => {
  assert.match(migration, /create table atlas\.flower_sale_order_cancellation_events/i);
  assert.match(migration, /create table atlas\.flower_ready_inventory_disposition_events/i);
  assert.match(migration, /flower_sale_order_cancellation_append_only_v1/i);
  assert.match(migration, /flower_ready_disposition_append_only_v1/i);
  assert.doesNotMatch(migration, /delete from atlas\.flower_sale_orders/i);
  assert.doesNotMatch(migration, /update atlas\.flower_ready_inventory_lots/i);
});

test("Available derives from active claims and explicit dispositions", () => {
  assert.match(migration, /flower_ready_available_quantity_v1/);
  assert.match(migration, /not exists[\s\S]*flower_sale_order_cancellation_events/i);
  assert.match(migration, /sum\(disposition\.quantity\)/i);
  assert.match(migration, /Sale would claim more than the Ready quantity still Available/i);
  assert.match(migration, /Disposition would remove more than the Ready quantity currently Available/i);
});

test("cancellation releases only unfulfilled claims and retires future fulfillment work canonically", () => {
  assert.match(migration, /A fulfilled flower sale cannot be cancelled by the claim-release path/i);
  assert.match(migration, /record_task_transition_v1_internal/);
  assert.match(migration, /'changed_plan'/);
  assert.match(migration, /state='cancelled'/);
  assert.match(migration, /A cancelled flower sale cannot be fulfilled/i);
});

test("customer-committed flower fulfillment is required hard-date work, not discretionary budget work", () => {
  assert.match(fulfillmentLane, /source_kind='flower_sale_order'/);
  assert.match(fulfillmentLane, /new\.work_lane:='required'/);
  assert.match(fulfillmentLane, /new\.commitment_kind:='hard_date'/);
  assert.match(fulfillmentLane, /cannot be suppressed by discretionary daily budget/i);
});

test("role boundaries distinguish physical spoilage from management dispositions", () => {
  assert.match(migration, /Farm Hand may cancel only a flower sale they recorded/i);
  assert.match(migration, /Farm Hand may record physical spoilage; donation and write-off require management authority/i);
});

test("sale v2 serializes Ready claims and keeps existing signed-in sale API signatures", () => {
  assert.match(migration, /record_flower_sale_core_v2/);
  assert.match(migration, /order by ready\.id[\s\S]*for update/i);
  assert.match(migration, /record_flower_sale_for_member_v1/);
  assert.match(migration, /owner_operator_record_flower_sale_v1/);
  assert.match(migration, /availabilityContract','cancellation_and_disposition_aware_v1/);
});

test("new reversal writes stay behind scoped authenticated wrappers and registry entries", () => {
  for (const name of [
    "cancel_flower_sale_for_member_v1",
    "owner_operator_cancel_flower_sale_v1",
    "record_flower_ready_disposition_for_member_v1",
    "owner_operator_record_flower_ready_disposition_v1",
  ]) {
    assert.match(migration, new RegExp(name));
    assert.match(registry, new RegExp(name));
  }
  assert.match(registry, /app_endpoint/);
  assert.match(registry, /owner_admin_endpoint/);
  assert.match(migration, /grant select on atlas\.flower_sale_order_cancellation_events to authenticated/i);
  assert.match(migration, /grant select on atlas\.flower_ready_inventory_disposition_events to authenticated/i);
  assert.doesNotMatch(migration, /grant (?:insert|update|delete|all) on atlas\.flower_(?:sale_order_cancellation_events|ready_inventory_disposition_events) to authenticated/i);
});
