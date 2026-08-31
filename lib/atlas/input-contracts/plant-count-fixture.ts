import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

export type PlantCountFixtureKey =
  | "california-giant"
  | "procut-plum"
  | "cosmos"
  | "volunteer-celosia";

type PlantCountFixtureDefinition = {
  key: PlantCountFixtureKey;
  crop: string;
  bed: string;
};

const PLANT_COUNT_FIXTURE_DEFINITIONS: PlantCountFixtureDefinition[] = [
  { key: "california-giant", crop: "California Giant / Spec", bed: "MG10" },
  { key: "procut-plum", crop: "ProCut Plum", bed: "Berry Walk Bed 3" },
  { key: "cosmos", crop: "Cosmos", bed: "MG10" },
  { key: "volunteer-celosia", crop: "Volunteer celosia", bed: "MG7" },
];

function createPlantCountFixtureContract(definition: PlantCountFixtureDefinition): AtlasInputContract {
  return {
    id: `fixture.elm.crop-cycle.living-plant-count.${definition.key}.v1`,
    kind: "count",
    title: definition.crop,
    detail: definition.bed,
    source: {
      domain: "crop-cycle",
      jurisdiction: "fixture:elm-farm",
      objectRef: `fixture:elm-farm:crop-cycle:${definition.key}:${definition.bed.toLowerCase().replaceAll(" ", "-")}`,
      claimRef: `count-living-plants-${definition.key}`,
    },
    fields: [
      {
        primitive: "quantity",
        id: "livingPlants",
        label: "Living plants",
        unit: "plant",
        displayUnit: "plants",
        displayUnitSingular: "plant",
        step: 1,
        minimum: 0,
        startUnset: true,
      },
    ],
    rules: [
      {
        kind: "required_field",
        fieldId: "livingPlants",
        message: "Record the living plant count, including 0.",
      },
    ],
    resultEventType: "atlas.crop_cycle.living_plant_count.result.fixture.v1",
    persistence: "fixture_only",
    sourceContext: {
      crop: definition.crop,
      bed: definition.bed,
      observationType: "living_plant_count",
    },
  };
}

export const PLANT_COUNT_FIXTURE_CONTRACTS = Object.fromEntries(
  PLANT_COUNT_FIXTURE_DEFINITIONS.map((definition) => [definition.key, createPlantCountFixtureContract(definition)]),
) as Record<PlantCountFixtureKey, AtlasInputContract>;

export type PlantCountFixtureAdjudication = {
  state: "count_recorded";
  todayClaimSatisfied: true;
  crop: string;
  bed: string;
  livingPlants: number;
  observedZero: boolean;
  canonicalCropCycleMutation: false;
};

function requiredContextText(event: AtlasInputResultEvent, key: "crop" | "bed") {
  const value = event.sourceContext[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Plant-count result is missing fixture context: ${key}`);
  }
  return value.trim();
}

export function adjudicatePlantCountFixtureResult(event: AtlasInputResultEvent): PlantCountFixtureAdjudication {
  if (event.eventType !== "atlas.crop_cycle.living_plant_count.result.fixture.v1") {
    throw new Error("Plant-count adjudication received the wrong Atlas result event.");
  }

  const livingPlants = event.values.livingPlants;
  if (typeof livingPlants !== "number" || !Number.isInteger(livingPlants) || livingPlants < 0) {
    throw new Error("Plant-count result requires an explicit whole-number count, including 0.");
  }

  return {
    state: "count_recorded",
    todayClaimSatisfied: true,
    crop: requiredContextText(event, "crop"),
    bed: requiredContextText(event, "bed"),
    livingPlants,
    observedZero: livingPlants === 0,
    canonicalCropCycleMutation: false,
  };
}
