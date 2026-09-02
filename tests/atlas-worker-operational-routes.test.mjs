import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

test("Farm Hand route projection is assignment-scoped and worker-safe", () => {
  const reader = read("lib/atlas-data/worker-operational-routes.ts");
  const page = read("app/work/today/page.tsx");

  assert.match(reader, /worker_operational_route_stops_v1/);
  assert.match(reader, /getWorkerOperationalRouteStopsForOrganization/);
  assert.match(reader, /getWorkerOperationalRouteStopsForFarm/);
  assert.doesNotMatch(reader, /price|revenue|totalAmount|paymentStatus|payload:/);
  assert.match(page, /data-worker-operational-routes="assigned-only"/);
  assert.match(page, /Stops for you/);
  assert.doesNotMatch(page, /sourceSystemKey|sourceAuthority|commercial/i);
});

test("task-backed route stops do not duplicate the worker's canonical task cards", () => {
  const page = read("app/work/today/page.tsx");
  assert.match(page, /executionTaskId/);
  assert.match(page, /taskIds/);
  assert.match(page, /!stop\.executionTaskId \|\| !taskIds\.has\(stop\.executionTaskId\)/);
  assert.match(page, /WorkerTaskCard/);
});

test("generic route UI supports service, product delivery, pickup, handoff, and mixed work", () => {
  const reader = read("lib/atlas-data/worker-operational-routes.ts");
  const actions = read("app/work/today/WorkerRouteStopActions.tsx");
  assert.match(reader, /product_delivery/);
  assert.match(reader, /product_pickup/);
  assert.match(reader, /service_visit/);
  assert.match(reader, /handoff/);
  assert.match(reader, /mixed/);
  assert.match(actions, /service_complete/);
  assert.match(actions, /handoff_complete/);
  assert.match(actions, /Delivered/);
  assert.match(actions, /Picked up/);
});

test("route-only completion goes through the generic governed RPC, not flower tables", () => {
  const api = read("app/api/atlas/operational-route-event/route.ts");
  assert.match(api, /record_operational_route_stop_event_v1/);
  assert.match(api, /same-origin/);
  assert.match(api, /getAtlasSession/);
  assert.doesNotMatch(api, /flower_sale_orders|flower_fulfillment_events|flower_ready_inventory/);
  assert.doesNotMatch(api, /\.insert\(/);
});

test("Owner Harvest remains commercial while Worker Day does not import the Harvest command center", () => {
  const ownerHarvest = read("app/harvest/page.tsx");
  const workerPage = read("app/work/today/page.tsx");
  assert.match(ownerHarvest, /HarvestWorkbenchSection/);
  assert.match(ownerHarvest, /HarvestOutboundSection|HarvestWorkbenchSection/);
  assert.doesNotMatch(workerPage, /HarvestWorkbenchSection|HarvestOutboundSection|Available Now|Assign \/ Send|On Route/);
});
