import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Harvest is a permanent task-card command center", () => {
  const page = read("app/harvest/page.tsx");
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");

  assert.match(page, /<HarvestWorkbenchSection \/>/);
  assert.match(workbench, /data-harvest-workbench="permanent-task-cards"/);
  assert.match(workbench, /AtlasTaskCardFrame/);
  assert.match(workbench, /title="Harvest Stems"/);
  assert.match(workbench, /title="Condition \+ Bunch"/);
  assert.match(workbench, /title="Assign \/ Send"/);
  assert.match(workbench, /title="Going Out"/);
  assert.match(workbench, /AVAILABLE NOW/);
  assert.match(workbench, /TODAY/);
  assert.match(workbench, /ACTIVITY/);
  assert.match(workbench, /BATCHES/);
});

test("Harvest task results and permanent-card results share canonical flower ledgers", () => {
  const ledger = read("app/api/atlas/harvest-ledger/route.ts");
  const writer = read("app/api/atlas/harvest-workbench/route.ts");

  for (const canonicalTable of [
    "flower_harvest_batches",
    "flower_harvest_bucket_observations",
    "flower_preparation_batches",
    "flower_ready_inventory_lots",
    "flower_sale_orders",
    "flower_sale_order_lines",
    "flower_fulfillment_events",
  ]) assert.match(ledger, new RegExp(canonicalTable));

  assert.doesNotMatch(ledger, /harvest_ledger_entries|flower_ledger_entries|workbench_inventory/);
  assert.match(ledger, /Task ·/);
  assert.match(ledger, /Harvest tab/);
  assert.match(writer, /record_flower_harvest_workbench_for_member_v1/);
  assert.match(writer, /record_flower_preparation_workbench_for_member_v1/);
  assert.doesNotMatch(writer, /\.insert\(/);
});

test("Available Now uses canonical inventory position including route custody", () => {
  const reader = read("app/api/atlas/harvest-command-center/route.ts");
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");

  assert.match(reader, /flower_ready_inventory_position_v1/);
  assert.match(reader, /on_prospect_route_quantity/);
  assert.match(reader, /flower_prospect_route_position_v1/);
  assert.match(workbench, /availableQuantity: positionByLot\.get\(lot\.id\)\?\.availableQuantity/);
  assert.match(workbench, /onRoute: positions\.reduce/);
  assert.match(workbench, /Made today/);
  assert.match(workbench, /Claimed/);
  assert.match(workbench, /On route/);
  assert.match(workbench, /Available now/);
});

test("Assign Send separates customer claims from unsold route custody", () => {
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");
  const routeApi = read("app/api/atlas/flower-prospect-route/route.ts");

  assert.match(workbench, /Customer \/ order/);
  assert.match(workbench, /Route \/ samples/);
  assert.match(workbench, /Someone outside Atlas/);
  assert.match(workbench, /Atlas worker/);
  assert.match(workbench, /fetch\("\/api\/atlas\/flower-commerce"/);
  assert.match(workbench, /fetch\("\/api\/atlas\/flower-prospect-route"/);

  assert.match(routeApi, /owner_operator_record_flower_prospect_route_v2/);
  assert.match(routeApi, /record_flower_prospect_route_for_member_v2/);
  assert.match(routeApi, /p_custodian_label/);
  assert.match(routeApi, /p_assigned_membership_id/);
});

test("Going Out can convert route inventory to a sale or return the unsold remainder", () => {
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");
  const routeApi = read("app/api/atlas/flower-prospect-route/route.ts");

  assert.match(workbench, /Return remaining/);
  assert.match(workbench, />Sold</);
  assert.match(workbench, /Handed off/);
  assert.match(routeApi, /record_flower_sale_from_prospect_for_member_v1/);
  assert.match(routeApi, /owner_operator_record_flower_sale_from_prospect_v1/);
  assert.match(routeApi, /release_flower_prospect_route_for_member_v1/);
  assert.match(routeApi, /owner_operator_release_flower_prospect_route_v1/);
  assert.match(routeApi, /p_reason_kind: "returned"/);
});

test("route custody is not silently treated as sale truth", () => {
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");
  const commandReader = read("app/api/atlas/harvest-command-center/route.ts");

  assert.match(workbench, /They are not counted as sold/);
  assert.match(workbench, /Only the sold quantity became sale truth/);
  assert.match(commandReader, /activeRoutes/);
  assert.match(commandReader, /soldQuantity/);
  assert.match(commandReader, /returnedQuantity/);
});

test("legacy Harvest reports remain secondary to the command center", () => {
  const page = read("app/harvest/page.tsx");
  const workbenchIndex = page.indexOf("<HarvestWorkbenchSection />");
  const historyIndex = page.indexOf("DETAILED HISTORY & CORRECTIONS");
  const legacyIndex = page.indexOf("<HarvestedOutputSection />");

  assert.ok(workbenchIndex >= 0);
  assert.ok(historyIndex > workbenchIndex);
  assert.ok(legacyIndex > historyIndex);
  assert.match(page, /UPCOMING & CROP OUTLOOK/);
});
