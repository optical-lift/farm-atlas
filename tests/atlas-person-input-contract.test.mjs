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

  for (const bed of ["bb3", "bb4", "bb5"]) {
    assert.match(harvest, new RegExp(`id: \"${bed}\"`));
  }
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
