import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Worker Day exposes small flower actuals logging without exposing Owner Harvest", () => {
  const page = read("app/work/today/page.tsx");
  const logging = read("app/work/today/WorkerFlowerLogging.tsx");

  assert.match(page, /WorkerFlowerLogging/);
  assert.match(page, /access\.membership\.role === "farm_hand" \? <WorkerFlowerLogging \/>/);
  assert.match(logging, /data-worker-flower-log="farm-hand-only"/);
  assert.match(logging, /Log another harvest/);
  assert.match(logging, /Log another prep batch/);
  assert.match(logging, /You logged today/);
  assert.match(logging, /If it has a task card, finish the task instead/);
  assert.doesNotMatch(logging, /HarvestWorkbenchSection|HarvestOutboundSection|Available Now|Assign \/ Send|On Route|revenue/i);
});

test("Farm Hand flower context is worker-safe and reads only physical logging context", () => {
  const api = read("app/api/atlas/worker-flower-log/route.ts");

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
});

test("Farm Hand quick logging reuses the canonical Harvest workbench write boundary", () => {
  const logging = read("app/work/today/WorkerFlowerLogging.tsx");
  const writer = read("app/api/atlas/harvest-workbench/route.ts");

  assert.match(logging, /fetch\("\/api\/atlas\/worker-flower-log"/);
  assert.match(logging, /fetch\("\/api\/atlas\/harvest-workbench"/);
  assert.match(writer, /record_flower_harvest_worker_quick_log_v1/);
  assert.match(writer, /record_flower_preparation_worker_quick_log_v1/);
  assert.match(writer, /owner_operator_record_flower_harvest_workbench_v1/);
  assert.match(writer, /owner_operator_record_flower_preparation_workbench_v1/);
  assert.doesNotMatch(writer, /\.insert\(/);
});

test("quick-log provenance stays distinct from Harvest-tab provenance", () => {
  const writer = read("app/api/atlas/harvest-workbench/route.ts");
  const logging = read("app/work/today/WorkerFlowerLogging.tsx");
  const reader = read("app/api/atlas/worker-flower-log/route.ts");
  const ownerLedger = read("app/api/atlas/harvest-ledger/route.ts");

  assert.match(writer, /workerQuickLog/);
  assert.match(reader, /\? "Quick log" : "Task"/);
  assert.match(ownerLedger, /entrySurface === "worker_day"/);
  assert.match(ownerLedger, /return "Worker quick log"/);
  assert.match(logging, /same flower history as task harvests/);
  assert.match(logging, /Ready inventory/);
});
