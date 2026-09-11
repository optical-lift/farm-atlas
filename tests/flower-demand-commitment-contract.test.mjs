import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("flower demand capture remains requested demand rather than implicit commitment", () => {
  const capture = read("app/api/atlas/flower-demand/route.ts");

  assert.match(capture, /p_demand_strength: "requested"/);
  assert.match(capture, /truthBoundary: "independent_demand"/);
  assert.doesNotMatch(capture, /commit_flower_demand_order/);
  assert.doesNotMatch(capture, /record_flower_sale/);
});

test("flower demand commitment invokes only the explicit commitment authority", () => {
  const commit = read("app/api/atlas/flower-demand/commit/route.ts");

  assert.match(commit, /commit_flower_demand_order_for_member_v1/);
  assert.match(commit, /owner_operator_commit_flower_demand_order_v1/);
  assert.match(commit, /truthBoundary: "demand_commitment_acceptance"/);
  assert.match(commit, /supplyClaimed: false/);
  assert.match(commit, /inventoryCommitted: false/);
  assert.match(commit, /saleRecorded: false/);
  assert.match(commit, /workerTimeScheduled: false/);
  assert.match(commit, /paymentStatus: "not_recorded"/);

  assert.doesNotMatch(commit, /record_flower_demand_allocation_core_v1/);
  assert.doesNotMatch(commit, /record_flower_sale_for_member_v1/);
  assert.doesNotMatch(commit, /owner_operator_record_flower_sale_v1/);
  assert.doesNotMatch(commit, /workerTimeScheduled: true|inventoryCommitted: true|saleRecorded: true|paymentStatus: "paid"/);
});

test("Katie's proof copy no longer claims request capture creates fulfillment truth", () => {
  const katie = read("app/owner/design-atlas/KatieOrderFixture.tsx");

  assert.match(katie, /Creates requested demand only/);
  assert.match(katie, /Requires explicit Owner or Manager acceptance/);
  assert.match(katie, /Requires separate reservation authority; this fixture does not claim stock/);
  assert.match(katie, /Not recorded until their own authorities say so/);
  assert.doesNotMatch(katie, /Creates a fulfillment obligation/);
});
