import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Farm Hand flower logging lives in Harvest, not Worker Day", () => {
  const workerDay = read("app/work/today/page.tsx");
  const harvestPage = read("app/harvest/page.tsx");
  const farmHandHarvest = read("app/harvest/FarmHandHarvestSection.tsx");

  assert.doesNotMatch(workerDay, /WorkerFlowerLogging|FarmHandHarvestSection|Flower logging/);
  assert.equal(existsSync(join(root, "app/work/today/WorkerFlowerLogging.tsx")), false);
  assert.match(harvestPage, /FarmHandHarvestSection/);
  assert.match(harvestPage, /surfaceRole === "farm_hand"/);
  assert.match(harvestPage, /data-harvest-surface="farm-hand"/);
  assert.match(farmHandHarvest, /data-farm-hand-harvest="physical-work-only"/);
  assert.match(farmHandHarvest, /Harvest Stems/);
  assert.match(farmHandHarvest, /Condition \+ Bunch/);
  assert.match(farmHandHarvest, /You logged today/);
  assert.match(farmHandHarvest, /If Atlas already gave you a task for the work, finish that task card instead/);
});

test("Farm Hand Harvest projection does not expose the Owner command center", () => {
  const page = read("app/harvest/page.tsx");
  const farmHandHarvest = read("app/harvest/FarmHandHarvestSection.tsx");

  assert.match(page, /surfaceRole === "farm_hand"/);
  assert.match(page, /<FarmHandHarvestSection \/>/);
  assert.match(page, /data-harvest-surface="owner-manager"/);
  assert.doesNotMatch(farmHandHarvest, /HarvestWorkbenchSection|HarvestOutboundSection|Available Now|Assign \/ Send|On Route|revenue|unit price|sale order/i);
});

test("Farm Hand Harvest context is Farm Hand-only and reads only physical flower context", () => {
  const api = read("app/api/atlas/farm-hand-harvest/route.ts");

  assert.match(api, /allowedRoles: \["farm_hand"\]/);
  for (const canonicalTable of [
    "crop_cycles",
    "flower_harvest_batches",
    "flower_harvest_bucket_observations",
    "flower_preparation_batches",
    "flower_ready_inventory_lots",
  ]) assert.match(api, new RegExp(canonicalTable));

  for (const ownerCommercialTruth of [
    "flower_sale_orders",
    "flower_sale_order_lines",
    "flower_prospect_routes",
    "flower_ready_inventory_position_v1",
    "unit_price",
    "line_total",
    "total_amount",
  ]) assert.doesNotMatch(api, new RegExp(ownerCommercialTruth));

  assert.match(api, /row\.recorded_by_membership_id === membershipId/);
  assert.match(api, /\.eq\("recorded_by_membership_id", membershipId\)/);
  assert.equal(existsSync(join(root, "app/api/atlas/worker-flower-log/route.ts")), false);
});

test("Farm Hand Harvest writes reuse canonical workbench authority with Harvest-tab provenance", () => {
  const farmHandHarvest = read("app/harvest/FarmHandHarvestSection.tsx");
  const writer = read("app/api/atlas/harvest-workbench/route.ts");
  const reader = read("app/api/atlas/farm-hand-harvest/route.ts");

  assert.match(farmHandHarvest, /fetch\("\/api\/atlas\/farm-hand-harvest"/);
  assert.match(farmHandHarvest, /fetch\("\/api\/atlas\/harvest-workbench"/);
  assert.match(writer, /farmHandHarvestTab/);
  assert.match(writer, /record_flower_harvest_farm_hand_tab_v1/);
  assert.match(writer, /record_flower_preparation_farm_hand_tab_v1/);
  assert.doesNotMatch(writer, /record_flower_harvest_worker_quick_log_v1|record_flower_preparation_worker_quick_log_v1/);
  assert.match(writer, /owner_operator_record_flower_harvest_workbench_v1/);
  assert.match(writer, /owner_operator_record_flower_preparation_workbench_v1/);
  assert.doesNotMatch(writer, /\.insert\(/);
  assert.match(reader, /entrySurface\"\) === \"harvest_tab\" \? \"Harvest\" : \"Task\"/);
  assert.match(farmHandHarvest, /same flower history as scheduled Harvest tasks/);
  assert.match(farmHandHarvest, /Ready inventory/);
});
