import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const phase9 = readFileSync(
  "supabase/migrations/20260818032834_harvest_inventory_reality_expression_v1.sql",
  "utf8",
);
const readinessFix = readFileSync(
  "supabase/migrations/20260818033031_harvest_inventory_field_readiness_status_fix_v1.sql",
  "utf8",
);
const revenueFix = readFileSync(
  "supabase/migrations/20260818033151_harvest_inventory_revenue_state_semantics_v1.sql",
  "utf8",
);
const registry = readFileSync(
  "supabase/migrations/20260818033215_harvest_inventory_reality_expression_rpc_registry_v1.sql",
  "utf8",
);

test("Phase 9 composes Harvest and Ready inventory without a universal claim table", () => {
  assert.match(
    phase9,
    /create or replace function atlas\.harvest_inventory_reality_expression_v1\(\s*p_ready_lot_id uuid\s*\)/i,
  );
  assert.match(phase9, /\bstable\b/i);
  assert.doesNotMatch(phase9, /security\s+definer/i);
  assert.doesNotMatch(phase9, /create\s+table/i);
  assert.match(phase9, /domainNativeRailsPreserved/i);
  assert.match(phase9, /noGenericClaimTableAdded/i);
});

test("Phase 9 preserves the field-ready to Harvest to processing to Ready lineage", () => {
  for (const token of [
    "crop_harvest_availability",
    "flower_harvest_batches",
    "flower_harvest_bucket_observations",
    "flower_preparation_batches",
    "flower_preparation_inputs",
    "flower_ready_inventory_lots",
    "field_ready_to_harvested_to_processing_to_ready_supported",
  ]) {
    assert.match(phase9, new RegExp(token, "i"));
  }
  assert.match(readinessFix, /ha\.status='harvestable'/i);
  assert.match(readinessFix, /explicit harvestable state/i);
});

test("physical custody and availability are explicitly different quantities", () => {
  assert.match(phase9, /physicalQuantity/i);
  assert.match(phase9, /availableQuantity/i);
  assert.match(phase9, /claimedQuantity/i);
  assert.match(phase9, /demandReservedQuantity/i);
  assert.match(phase9, /soldCommittedQuantity/i);
  assert.match(phase9, /onProspectRouteQuantity/i);
  assert.match(phase9, /fulfilledQuantity/i);
  assert.match(phase9, /disposedQuantity/i);
  assert.match(phase9, /partially_available_after_claims/i);
  assert.match(phase9, /Physical existence is separate from availability/i);
  assert.match(phase9, /physicalIsNotAvailable/i);
});

test("customer, event, and route claims retain source, destination, strength, and authority", () => {
  for (const token of [
    "claimSource",
    "claimSubject",
    "claimedQuantity",
    "intendedDestination",
    "requiredBy",
    "claimStrength",
    "displacementAuthority",
    "protectionReason",
    "sourceEvidence",
    "event_sale_commitment",
    "prospect_route_custody",
  ]) {
    assert.match(phase9, new RegExp(token, "i"));
  }
  assert.match(phase9, /flower_demand_sale_line_links/i);
  assert.match(phase9, /fulfilled sale lines are no longer active claims/i);
});

test("fulfillment and damaged or unsellable disposition are custody movements", () => {
  assert.match(phase9, /flower_fulfillment_events/i);
  assert.match(phase9, /flower_ready_inventory_disposition_events/i);
  assert.match(phase9, /Fulfillment and disposition are custody exits/i);
  assert.match(phase9, /disposedIsNotPhysicalInventory/i);
  assert.match(phase9, /fulfilledIsNotCurrentClaim/i);
});

test("revenue and demand distinguish outstanding commitments from realized revenue", () => {
  assert.match(phase9, /flower_supply_demand_balance_v1/i);
  assert.match(revenueFix, /recordedNoncancelledSaleRevenue/i);
  assert.match(revenueFix, /outstandingCommittedProductRevenue/i);
  assert.match(revenueFix, /realized_product_revenue/i);
  assert.match(revenueFix, /Outstanding committed revenue excludes fulfilled sale value/i);
});

test("Phase 9 packet is read-only over canonical Harvest and commercial rails", () => {
  assert.doesNotMatch(
    phase9,
    /\b(insert\s+into|update|delete\s+from)\s+atlas\.(flower_|crop_harvest|production_harvest|postharvest)/i,
  );
});

test("Phase 9 service-internal privilege boundary matches the RPC registry", () => {
  assert.match(phase9, /revoke all on function atlas\.harvest_inventory_reality_expression_v1\(uuid\) from authenticated/i);
  assert.match(phase9, /grant execute on function atlas\.harvest_inventory_reality_expression_v1\(uuid\) to service_role/i);
  assert.match(registry, /atlas\.harvest_inventory_reality_expression_v1\(uuid\)/i);
  assert.match(registry, /'service_internal','verified','active',false,false,true/i);
  assert.match(registry, /No generic claim table and no direct authenticated execution/i);
});