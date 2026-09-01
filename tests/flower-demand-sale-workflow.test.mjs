import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(join(root, path), "utf8");

const route = read("app/api/atlas/flower-demand-workflow/route.ts");
const workspace = read("app/harvest/FlowerDemandSection.tsx");
const outbound = read("app/harvest/HarvestOutboundSection.tsx");

test("generic flower demand workflow delegates every commercial transition to governed RPCs", () => {
  for (const rpc of [
    "commit_flower_demand_order_for_member_v1",
    "owner_operator_commit_flower_demand_order_v1",
    "record_flower_demand_line_price_for_member_v1",
    "owner_operator_record_flower_demand_line_price_v1",
    "record_flower_demand_allocation_for_member_v1",
    "owner_operator_record_flower_demand_allocation_v1",
    "release_flower_demand_allocation_for_member_v1",
    "owner_operator_release_flower_demand_allocation_v1",
    "record_flower_sale_from_demand_for_member_v1",
    "owner_operator_record_flower_sale_from_demand_v1",
    "cancel_flower_demand_order_for_member_v1",
    "owner_operator_cancel_flower_demand_order_v1",
  ]) assert.match(route, new RegExp(rpc));

  assert.match(route, /flower_ready_inventory_position_v1/);
  assert.match(route, /flower_demand_coverage_v1/);
  assert.match(route, /flower_demand_allocation_position_v1/);
  assert.match(route, /requireAtlasApiAccess/);
  assert.match(route, /createAtlasServerClient/);
  assert.doesNotMatch(route, /SUPABASE_SERVICE_ROLE_KEY|atlasSupabase/);
});

test("demand workflow does not manufacture commercial truth in the app layer", () => {
  assert.doesNotMatch(route, /\.from\("flower_sale_orders"\)\.insert/);
  assert.doesNotMatch(route, /\.from\("flower_demand_orders"\)\.(?:insert|update|delete)/);
  assert.doesNotMatch(route, /\.from\("flower_demand_order_lines"\)\.(?:insert|update|delete)/);
  assert.doesNotMatch(route, /payment_status|paymentStatus\s*:/);
  assert.doesNotMatch(workspace, /payment status|mark paid|record payment/i);
});

test("Harvest exposes demand before movement and gates Sale conversion on explicit truth", () => {
  assert.match(outbound, /<FlowerDemandSection\s*\/>/);
  assert.match(workspace, /effectiveDemandStrength === "requested"/);
  assert.match(workspace, /order\.effectiveDemandStrength === "committed" && order\.allPriced/);
  assert.match(workspace, /order\.allCovered/);
  assert.match(workspace, /Convert to Sale/);
  assert.match(workspace, /Demand alone never does/);
});

test("the generic demand workflow has no Springfield-specific buyer or product adapter", () => {
  const forbidden = [
    /Ruth/i,
    /Linda/i,
    /Springfield/i,
    /Schaffitzel/i,
    /Talmage/i,
    /SUNFLOWER_BUYER/i,
    /SAMPLE_BUYER/i,
  ];
  for (const pattern of forbidden) {
    assert.doesNotMatch(route, pattern);
    assert.doesNotMatch(workspace, pattern);
  }
});

test("Ready matching mirrors database allocation constraints instead of guessing product identity", () => {
  assert.match(workspace, /lot\.inventoryKind !== line\.inventoryKind \|\| lot\.unit !== line\.unit/);
  assert.match(workspace, /line\.cropProfileId && lot\.cropProfileId !== line\.cropProfileId/);
  assert.match(workspace, /line\.inventoryKind === "bundle" && lot\.stemsPerUnit !== line\.stemsPerUnit/);
  assert.doesNotMatch(workspace, /productLabel === line\.productLabel/);
});
