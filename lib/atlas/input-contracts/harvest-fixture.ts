import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

const HARVEST_FIELD_IDS = ["bb3", "bb4", "bb5"];

export const HARVEST_WHITE_LITE_INPUT_CONTRACT: AtlasInputContract = {
  id: "fixture.harvest.white-lite.bb3-5.v1",
  kind: "harvest",
  title: "White Lite",
  detail: "Barn Beds 3–5 · ½-bucket counts",
  source: {
    domain: "harvest",
    jurisdiction: "elm-farm",
    objectRef: "fixture:white-lite:bb3-5",
    claimRef: "harvest-white-lite",
  },
  fields: [
    { primitive: "quantity", id: "bb3", label: "BB3", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0 },
    { primitive: "quantity", id: "bb4", label: "BB4", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0 },
    { primitive: "quantity", id: "bb5", label: "BB5", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0 },
    {
      primitive: "choice",
      id: "moreAvailability",
      label: "more still out there?",
      options: [
        { value: "yes", label: "yes" },
        { value: "unsure", label: "not sure" },
        { value: "no", label: "no" },
      ],
    },
  ],
  rules: [
    {
      kind: "minimum_quantity_total",
      fieldIds: HARVEST_FIELD_IDS,
      minimum: 0.5,
      message: "Record at least ½ bucket of observed harvest.",
    },
    {
      kind: "required_field",
      fieldId: "moreAvailability",
      message: "Record whether more harvest is still out there.",
    },
  ],
  resultEventType: "atlas.harvest.result.fixture.v1",
  persistence: "fixture_only",
  sourceContext: {
    crop: "White Lite",
    place: "Barn Beds 3–5",
    targetQuantity: 6,
    targetUnit: "bucket_equivalent",
  },
};

export type HarvestFixtureAdjudication = {
  state: "target_met" | "remaining" | "availability_uncertain" | "closed_short";
  observedQuantity: number;
  targetQuantity: number;
  remainingQuantity: number;
};

export function adjudicateHarvestFixtureResult(event: AtlasInputResultEvent): HarvestFixtureAdjudication {
  if (event.eventType !== HARVEST_WHITE_LITE_INPUT_CONTRACT.resultEventType) {
    throw new Error("Harvest adjudication received the wrong Atlas result event.");
  }

  const targetQuantity = Number(event.sourceContext.targetQuantity ?? 0);
  const observedQuantity = event.aggregates.quantityTotal;
  const remainingQuantity = Math.max(0, targetQuantity - observedQuantity);
  const moreAvailability = event.values.moreAvailability;

  if (remainingQuantity <= 0) {
    return { state: "target_met", observedQuantity, targetQuantity, remainingQuantity: 0 };
  }
  if (moreAvailability === "yes") {
    return { state: "remaining", observedQuantity, targetQuantity, remainingQuantity };
  }
  if (moreAvailability === "unsure") {
    return { state: "availability_uncertain", observedQuantity, targetQuantity, remainingQuantity };
  }
  return { state: "closed_short", observedQuantity, targetQuantity, remainingQuantity };
}
