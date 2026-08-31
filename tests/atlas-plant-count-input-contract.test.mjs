import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

test("quantity observations can begin unknown without turning unknown into zero", () => {
  const contract = read("lib/atlas/input-contract.ts");
  const renderer = read("components/atlas/input/AtlasInputRenderer.tsx");

  assert.match(contract, /startUnset\?: boolean/);
  assert.match(contract, /wholeNumber\?: boolean/);
  assert.match(contract, /field\.startUnset/);
  assert.match(contract, /\? null/);
  assert.match(renderer, /row\.startUnset && storedValue === null/);
  assert.match(renderer, /hasStoredValue \? String\(value\) : \"\"/);
  assert.match(renderer, /row\.wholeNumber/);
  assert.match(renderer, /rows\.length > 1/);
});

test("living-plant counts use one reusable whole-number input contract and accept explicit zero", () => {
  const plantCount = read("lib/atlas/input-contracts/plant-count-fixture.ts");

  assert.match(plantCount, /primitive: \"quantity\"/);
  assert.match(plantCount, /id: \"livingPlants\"/);
  assert.match(plantCount, /unit: \"plants\"/);
  assert.match(plantCount, /step: 1/);
  assert.match(plantCount, /minimum: 0/);
  assert.match(plantCount, /startUnset: true/);
  assert.match(plantCount, /wholeNumber: true/);
  assert.match(plantCount, /kind: \"required_field\"/);
  assert.match(plantCount, /including 0/);
  assert.match(plantCount, /Number\.isInteger\(livingPlants\)/);
  assert.match(plantCount, /observedZero: livingPlants === 0/);
  assert.doesNotMatch(plantCount, /minimum_quantity_total/);
});

test("the four visible crop-cycle checks summon the same generic input spread", () => {
  const fixture = read("app/owner/design-atlas/PlantCountFixture.tsx");
  const bridge = read("app/owner/design-atlas/BridgeAtlasFixture.tsx");
  const routes = [
    "california-giant",
    "procut-plum",
    "cosmos",
    "volunteer-celosia",
  ];

  assert.match(fixture, /California Giant \/ Spec/);
  assert.match(fixture, /ProCut Plum/);
  assert.match(fixture, /Cosmos/);
  assert.match(fixture, /Volunteer celosia/);
  assert.match(fixture, /Berry Walk Bed 3/);
  assert.match(fixture, /MG10/);
  assert.match(fixture, /MG7/);

  for (const route of routes) {
    assert.match(fixture, new RegExp(`/owner/input/plant-count/${route}`));
    const page = read(`app/owner/input/plant-count/${route}/page.tsx`);
    assert.match(page, /PersonAtlasInputSpread/);
    assert.match(page, /PLANT_COUNT_FIXTURE_CONTRACTS/);
  }

  assert.match(bridge, /href: \"\/owner\/design-atlas\/plant-count\"/);
});

test("observation and measurement tasks are not executable without an input contract", () => {
  const readiness = read("lib/atlas/task-input-readiness.ts");

  assert.match(readiness, /\"human_observation\" \| \"human_measurement\"/);
  assert.match(readiness, /state: \"awaiting_input_contract\"/);
  assert.match(readiness, /executable: false/);
  assert.match(readiness, /requires an input contract before the task is executable/);
});

test("plant-count design proof remains fixture-only even though the shared renderer can submit canonical contracts", () => {
  const plantCount = read("lib/atlas/input-contracts/plant-count-fixture.ts");
  const renderer = read("components/atlas/input/AtlasInputRenderer.tsx");

  assert.match(plantCount, /persistence: \"fixture_only\"/);
  assert.match(plantCount, /canonicalCropCycleMutation: false/);
  assert.doesNotMatch(plantCount, /supabase|rpc\(|insert\(|update\(/i);
  assert.doesNotMatch(renderer, /California Giant|ProCut Plum|Cosmos|celosia|crop-cycle/i);
  assert.match(renderer, /submission\?: AtlasInputSubmission/);
  assert.match(renderer, /fetch\(submission\.endpoint/);
  assert.match(renderer, /data-atlas-input-persistence/);
});
