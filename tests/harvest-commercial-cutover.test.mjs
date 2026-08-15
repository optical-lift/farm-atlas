import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path) { return readFileSync(new URL(`../${path}`, import.meta.url), "utf8"); }

const audit = read("docs/HARVEST_COMMERCIAL_CUTOVER_AUDIT.md");
const commerceRoute = read("app/api/atlas/flower-commerce/route.ts");
const commercialSurface = read("app/harvest/FlowerCommercialSection.tsx");

test("commercial cutover preserves relationship and event domains without using them as flower sale truth", () => {
  for (const primitive of [
    "buyer_relationship_reconstruction",
    "buyer_contact_events",
    "community_events",
    "community_registration_payments",
  ]) assert.match(audit, new RegExp(primitive));
  assert.match(audit, /quoted quantity or price is not a Ready claim, sale, or fulfillment fact/i);
  assert.match(audit, /ticket\/attendance\/program-registration values remain event\/registration truth/i);
});

test("Friday and market task metadata are explicitly cut over from writable commercial truth", () => {
  assert.match(audit, /Manage Friday bouquet claims/);
  assert.match(audit, /Reconcile Friday Flowers inventory at noon/);
  assert.match(audit, /Sales Data Entry/);
  assert.match(audit, /starting_inventory/);
  assert.match(audit, /submission_owns_sales_record: true/);
  assert.match(audit, /DEPRECATE AS WRITABLE TRUTH/);
  assert.match(audit, /structured flower commercial ledger owns the sale record/i);
});

test("historical task evidence is preserved without manufacturing commercial history", () => {
  assert.match(audit, /Historical task metadata remains evidence, not a second current ledger/i);
  assert.match(audit, /2 bouquets sold/);
  assert.match(audit, /does not justify inferred revenue/i);
  assert.match(audit, /old inventory counts are not retroactively treated as Ready birth rows/i);
});

test("canonical commercial reader does not reconstruct inventory or sales from legacy task metadata", () => {
  for (const source of [commerceRoute, commercialSurface]) {
    assert.doesNotMatch(source, /starting_inventory|inventory_state_model|submission_owns_sales_record|market_sales_capture_v1|standard_sales_data_entry_task/);
  }
  assert.match(commerceRoute, /flower_ready_inventory_lots/);
  assert.match(commerceRoute, /flower_sale_order_lines/);
  assert.match(commercialSurface, /Ready birth quantity minus explicit sale claims/);
});
