import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("Atlas input intelligence is source-contracted instead of a generic form builder", () => {
  const contract = read("lib/atlas/input-contract.ts");
  const spread = read("app/owner/PersonAtlasInputSpread.tsx");

  assert.match(contract, /AtlasInputContract/);
  assert.match(contract, /source: AtlasInputSourceRef/);
  assert.match(contract, /resultEventType: string/);
  assert.match(contract, /validateAtlasInput/);
  assert.match(contract, /createAtlasInputResultEvent/);
  assert.match(contract, /persistence: \"fixture_only\" \| \"canonical\"/);
  assert.match(spread, /contract: AtlasInputContract/);
  assert.match(spread, /validateAtlasInput\(contract, values\)/);
  assert.match(spread, /createAtlasInputResultEvent\(contract, values\)/);
  assert.doesNotMatch(spread, /minimumTotal\?:|followUp\?:/);
});

test("Harvest preserves half-bucket field truth and explicit remaining-availability truth", () => {
  const harvest = read("lib/atlas/input-contracts/harvest-fixture.ts");

  for (const bed of ["bb3", "bb4", "bb5"]) assert.match(harvest, new RegExp(`id: \"${bed}\"`));
  assert.match(harvest, /unit: \"bucket_equivalent\"/);
  assert.match(harvest, /step: 0\.5/);
  assert.match(harvest, /minimum: 0\.5/);
  assert.match(harvest, /id: \"moreAvailability\"/);
  assert.match(harvest, /value: \"yes\"/);
  assert.match(harvest, /value: \"unsure\"/);
  assert.match(harvest, /value: \"no\"/);
  assert.match(harvest, /kind: \"required_field\"/);
  assert.match(harvest, /targetQuantity: 6/);
});

test("Harvest result adjudication remains source logic after the generic input event", () => {
  const harvest = read("lib/atlas/input-contracts/harvest-fixture.ts");

  assert.match(harvest, /adjudicateHarvestFixtureResult/);
  assert.match(harvest, /state: \"target_met\"/);
  assert.match(harvest, /state: \"remaining\"/);
  assert.match(harvest, /state: \"availability_uncertain\"/);
  assert.match(harvest, /state: \"closed_short\"/);
  assert.match(harvest, /remainingQuantity = Math\.max\(0, targetQuantity - observedQuantity\)/);
});

test("Today summons the Harvest instrument instead of requiring a second task list", () => {
  const fixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
  const page = read("app/owner/input/harvest/page.tsx");

  assert.match(fixture, /id: \"harvest-white-lite\"/);
  assert.match(fixture, /\"harvest-white-lite\": \"\/owner\/input\/harvest\"/);
  assert.match(page, /HARVEST_WHITE_LITE_INPUT_CONTRACT/);
  assert.match(page, /contract=\{HARVEST_WHITE_LITE_INPUT_CONTRACT\}/);
});

test("Household proves the same input contract can capture condition without quantities", () => {
  const household = read("lib/atlas/input-contracts/household-zone-fixture.ts");

  assert.match(household, /domain: \"household\"/);
  assert.match(household, /jurisdiction: \"person-private\"/);
  assert.match(household, /primitive: \"choice\"/);
  assert.match(household, /id: \"zoneCondition\"/);
  assert.match(household, /value: \"still_rough\"/);
  assert.match(household, /value: \"mostly_clear\"/);
  assert.match(household, /value: \"all_clear\"/);
  assert.doesNotMatch(household, /primitive: \"quantity\"/);
});

test("a FlyLady zone pass satisfies Today's claim even when the room still needs future attention", () => {
  const household = read("lib/atlas/input-contracts/household-zone-fixture.ts");

  assert.match(household, /adjudicateHouseholdZoneFixtureResult/);
  assert.match(household, /todayClaimSatisfied: true/);
  assert.match(household, /futureZoneAttention: condition !== \"all_clear\"/);
  assert.doesNotMatch(household, /todayClaimSatisfied: condition === \"all_clear\"/);
});

test("live Household Care remains the source while Today summons its dedicated result instrument", () => {
  const fixture = read("app/owner/OwnerPersonAtlasFixture.tsx");
  const inputPage = read("app/owner/input/household-zone/page.tsx");
  const sourcePage = read("app/owner/household/page.tsx");
  const source = read("app/owner/household/HouseholdCollectionFixture.tsx");
  const actions = read("app/owner/household/actions.ts");

  assert.match(fixture, /id: \"household-zone\"/);
  assert.match(fixture, /\"household-zone\": \"\/owner\/input\/household-zone\"/);
  assert.match(inputPage, /HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT/);
  assert.match(inputPage, /contract=\{HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT\}/);
  assert.match(sourcePage, /readPrincipalHouseholdCare/);
  assert.match(source, /Teach Atlas your home/);
  assert.match(source, /how the home is holding/);
  assert.match(source, /no chore is created by the clock/);
  assert.match(actions, /principal_upsert_dwelling_api_v1/);
  assert.match(actions, /principal_upsert_household_space_api_v1/);
  assert.match(actions, /principal_record_household_care_observation_api_v1/);
  assert.match(actions, /principal_record_household_care_result_api_v1/);
});

test("flower orders prove one input contract can capture a buyer and several ordered line quantities", () => {
  const order = read("lib/atlas/input-contracts/flower-order-fixture.ts");

  assert.match(order, /domain: \"buyer-distribution\"/);
  assert.match(order, /jurisdiction: \"institution:feast-guild\"/);
  assert.match(order, /responsibilityGrammar: \"flow\"/);
  assert.match(order, /id: \"buyer\"/);
  assert.match(order, /value: \"ruth\"/);
  assert.match(order, /value: \"lindas\"/);
  assert.match(order, /id: \"sunflowerBundles\"/);
  assert.match(order, /label: \"Sunflower bundles\"/);
  assert.match(order, /id: \"samples\"/);
  assert.match(order, /kind: \"minimum_quantity_total\"/);
  assert.match(order, /fieldIds: \[\"sunflowerBundles\", \"samples\"\]/);
  assert.doesNotMatch(order, /bunch/i);
});

test("canonical flower vocabulary separates harvest truth from prepared form", () => {
  const vocabulary = read("lib/atlas/flower-vocabulary.ts");

  assert.match(vocabulary, /FLOWER_HARVEST_GRADES = \[\"florist_grade\", \"event_grade\"\]/);
  assert.match(vocabulary, /FLOWER_NON_HARVEST_DISPOSITIONS = \[\"deadheaded\", \"crop_loss\"\]/);
  assert.match(vocabulary, /FLOWER_SELLABLE_FORMS = \[\"stem\", \"bundle\", \"posy\", \"bouquet\", \"arrangement\"\]/);
  assert.match(vocabulary, /FLOWER_BUNDLE_STEM_COUNTS = \[5, 10, 20\]/);
  assert.match(vocabulary, /preparation: \"stripped_and_rubber_banded\"/);
  assert.match(vocabulary, /wrapping: \"paper\"/);
  assert.match(vocabulary, /flowerFeedPlacement: \"inside_rubber_band\"/);
  assert.match(vocabulary, /container: \"vase_or_jar\"/);
  assert.doesNotMatch(vocabulary, /bunch/i);
});

test("recording an order creates fulfillment demand without fabricating inventory movement or payment", () => {
  const order = read("lib/atlas/input-contracts/flower-order-fixture.ts");

  assert.match(order, /adjudicateFlowerOrderFixtureResult/);
  assert.match(order, /state: \"order_recorded\"/);
  assert.match(order, /todayClaimSatisfied: true/);
  assert.match(order, /fulfillmentRequired: true/);
  assert.match(order, /inventoryClaimRequired: true/);
  assert.match(order, /inventoryCommitted: false/);
  assert.match(order, /paymentStatus: \"not_recorded\"/);
  assert.doesNotMatch(order, /paymentStatus: \"paid\"/);
  assert.doesNotMatch(order, /inventoryCommitted: true/);
});

test("order consequences cross authorities through a generic handoff instead of hidden sales mutations", () => {
  const handoff = read("lib/atlas/authority-handoff.ts");
  const order = read("lib/atlas/input-contracts/flower-order-fixture.ts");
  const spread = read("app/owner/PersonAtlasInputSpread.tsx");

  assert.match(handoff, /AtlasAuthorityClaimState = \"required\" \| \"not_recorded\"/);
  assert.match(handoff, /ledger: \"company_work\"/);
  assert.match(handoff, /createAtlasAuthorityHandoff/);
  assert.match(handoff, /does not resolve the claim, mutate the target ledger/);
  assert.doesNotMatch(handoff, /Ruth|Linda|sunflower|Stripe|sellable_inventory/i);

  assert.match(order, /createAtlasAuthorityHandoff\(event/);
  assert.match(order, /kind: \"inventory_availability\"/);
  assert.match(order, /authority: inventoryAuthority/);
  assert.match(order, /state: \"required\"/);
  assert.match(order, /kind: \"payment_status\"/);
  assert.match(order, /authority: paymentAuthority/);
  assert.match(order, /state: \"not_recorded\"/);
  assert.match(order, /ledger: \"company_work\"/);
  assert.match(order, /state: \"open\"/);
  assert.match(order, /operationClass: \"order_fulfillment\"/);
  assert.match(order, /dependsOnAuthorityClaimIds: \[\"inventory-availability\"\]/);
  assert.doesNotMatch(spread, /authority-handoff|inventory_availability|payment_status|company_work/);
});

test("Katie's one-line flower-order thought opens the generic source-contracted instrument", () => {
  const katie = read("app/owner/design-atlas/KatieOrderFixture.tsx");
  const route = read("app/owner/input/flower-order/page.tsx");
  const bridge = read("app/owner/design-atlas/BridgeAtlasFixture.tsx");
  const spread = read("app/owner/PersonAtlasInputSpread.tsx");

  assert.match(katie, /sentence: \"Record the next Springfield flower order\"/);
  assert.match(katie, /\"record-flower-order\": \"\/owner\/input\/flower-order\"/);
  assert.match(route, /SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT/);
  assert.match(route, /contract=\{SPRINGFIELD_FLOWER_ORDER_INPUT_CONTRACT\}/);
  assert.match(route, /returnHref=\"\/owner\/design-atlas\/katie-order\"/);
  assert.match(bridge, /href: \"\/owner\/design-atlas\/katie-order\"/);
  assert.doesNotMatch(spread, /Ruth|Linda|sunflower|flower order|Stripe/i);
});
