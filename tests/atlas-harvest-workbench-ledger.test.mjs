import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Harvest primary surface is permanent task cards with a live ledger", () => {
  const page = read("app/harvest/page.tsx");
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");

  assert.match(page, /<HarvestWorkbenchSection \/>/);
  assert.match(workbench, /data-harvest-workbench="permanent-task-cards"/);
  assert.match(workbench, /AtlasTaskCardFrame/);
  assert.match(workbench, /title="Harvest Stems"/);
  assert.match(workbench, /title="Condition \+ Bunch"/);
  assert.match(workbench, /title="Sell \/ Claim"/);
  assert.match(workbench, /title="Handoff"/);
  assert.match(workbench, /AVAILABLE NOW/);
  assert.match(workbench, />TODAY</);
  assert.match(workbench, />ACTIVITY</);
  assert.match(workbench, />BATCHES</);
});

test("Harvest tab and scheduled tasks accumulate into the same canonical flower history", () => {
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
  assert.match(writer, /owner_operator_record_flower_harvest_workbench_v1/);
  assert.match(writer, /record_flower_preparation_workbench_for_member_v1/);
  assert.match(writer, /owner_operator_record_flower_preparation_workbench_v1/);
  assert.doesNotMatch(writer, /\.from\("flower_harvest|\.from\("flower_ready|\.insert\(/);
});

test("permanent Sell and Handoff cards reuse canonical commerce and fulfillment writes", () => {
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");
  const fulfillmentRoute = read("app/api/atlas/flower-fulfillment/route.ts");

  assert.match(workbench, /fetch\("\/api\/atlas\/flower-commerce"/);
  assert.match(workbench, /fetch\("\/api\/atlas\/flower-fulfillment"/);
  assert.match(fulfillmentRoute, /\[89ab\]\[0-9a-f\]\{3\}-\[0-9a-f\]\{12\}/);
});

test("legacy report surfaces are secondary instead of dominating Harvest", () => {
  const page = read("app/harvest/page.tsx");
  const workbenchIndex = page.indexOf("<HarvestWorkbenchSection />");
  const historyIndex = page.indexOf("DETAILED HISTORY & CORRECTIONS");
  const legacyIndex = page.indexOf("<HarvestedOutputSection />");

  assert.ok(workbenchIndex >= 0);
  assert.ok(historyIndex > workbenchIndex);
  assert.ok(legacyIndex > historyIndex);
  assert.match(page, /<details className="atlas-harvest-outlook atlas-harvest-history">/);
  assert.match(page, /UPCOMING & CROP OUTLOOK/);
});

test("live ledger supports separate batches and cumulative available inventory", () => {
  const ledger = read("app/api/atlas/harvest-ledger/route.ts");
  const workbench = read("app/harvest/HarvestWorkbenchSection.tsx");

  assert.match(ledger, /available = Math\.max\(0, birth - committed - disposed\)/);
  assert.match(ledger, /product\.madeToday \+= birth/);
  assert.match(ledger, /product\.claimed \+= claimed/);
  assert.match(ledger, /product\.out \+= out/);
  assert.match(ledger, /product\.availableNow \+= available/);
  assert.match(ledger, /batches: \{ harvest: harvestRuns, preparation: preparationBatches \}/);
  assert.match(workbench, /separate prep run, while the inventory total accumulates/i);
});
