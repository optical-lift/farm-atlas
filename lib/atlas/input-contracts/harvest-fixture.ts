import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

const HARVEST_FIELD_IDS = ["bb3", "bb4", "bb5"];
const HARVEST_CONDITION = { fieldId: "recordKind", equals: "harvest" } as const;

export const HARVEST_WHITE_LITE_INPUT_CONTRACT: AtlasInputContract = {
  id: "fixture.harvest.white-lite.bb3-5.v2",
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
    {
      primitive: "choice",
      id: "recordKind",
      label: "what happened?",
      options: [
        { value: "harvest", label: "cut harvest" },
        { value: "deadheaded", label: "deadheaded" },
        { value: "crop_loss", label: "crop loss" },
      ],
    },
    {
      primitive: "choice",
      id: "grade",
      label: "grade",
      visibleWhen: HARVEST_CONDITION,
      options: [
        { value: "florist_grade", label: "florist grade" },
        { value: "event_grade", label: "event grade" },
      ],
    },
    { primitive: "quantity", id: "bb3", label: "BB3", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0, visibleWhen: HARVEST_CONDITION },
    { primitive: "quantity", id: "bb4", label: "BB4", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0, visibleWhen: HARVEST_CONDITION },
    { primitive: "quantity", id: "bb5", label: "BB5", unit: "bucket_equivalent", displayUnit: "buckets", displayUnitSingular: "bucket", step: 0.5, minimum: 0, visibleWhen: HARVEST_CONDITION },
    {
      primitive: "choice",
      id: "moreAvailability",
      label: "more still out there?",
      visibleWhen: HARVEST_CONDITION,
      options: [
        { value: "yes", label: "yes" },
        { value: "unsure", label: "not sure" },
        { value: "no", label: "no" },
      ],
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "recordKind",
      message: "Record what happened in the bed.",
    },
    {
      kind: "required_field",
      fieldId: "grade",
      when: HARVEST_CONDITION,
      message: "Record whether the cut harvest is florist grade or event grade.",
    },
    {
      kind: "minimum_quantity_total",
      fieldIds: HARVEST_FIELD_IDS,
      minimum: 0.5,
      when: HARVEST_CONDITION,
      message: "Record at least ½ bucket of observed harvest.",
    },
    {
      kind: "required_field",
      fieldId: "moreAvailability",
      when: HARVEST_CONDITION,
      message: "Record whether more harvest is still out there.",
    },
  ],
  resultEventType: "atlas.harvest.result.fixture.v2",
  persistence: "fixture_only",
  sourceContext: {
    crop: "White Lite",
    place: "Barn Beds 3–5",
    targetQuantity: 6,
    targetUnit: "bucket_equivalent",
  },
};

export type HarvestFixtureGrade = "florist_grade" | "event_grade";
export type HarvestFixtureAdjudication =
  | {
      state: "target_met" | "remaining" | "availability_uncertain" | "closed_short";
      recordKind: "harvest";
      grade: HarvestFixtureGrade;
      observedQuantity: number;
      targetQuantity: number;
      remainingQuantity: number;
      createsHarvestInventory: true;
    }
  | {
      state: "non_harvest_observation";
      recordKind: "deadheaded" | "crop_loss";
      createsHarvestInventory: false;
    };

export function adjudicateHarvestFixtureResult(event: AtlasInputResultEvent): HarvestFixtureAdjudication {
  if (event.eventType !== HARVEST_WHITE_LITE_INPUT_CONTRACT.resultEventType) {
    throw new Error("Harvest adjudication received the wrong Atlas result event.");
  }

  const recordKind = event.values.recordKind;
  if (recordKind === "deadheaded" || recordKind === "crop_loss") {
    return {
      state: "non_harvest_observation",
      recordKind,
      createsHarvestInventory: false,
    };
  }
  if (recordKind !== "harvest") {
    throw new Error("Harvest result is missing the observed outcome kind.");
  }

  const grade = event.values.grade;
  if (grade !== "florist_grade" && grade !== "event_grade") {
    throw new Error("Harvest result is missing the required cut-harvest grade.");
  }

  const targetQuantity = Number(event.sourceContext.targetQuantity ?? 0);
  const observedQuantity = event.aggregates.quantityTotal;
  const remainingQuantity = Math.max(0, targetQuantity - observedQuantity);
  const moreAvailability = event.values.moreAvailability;
  const base = {
    recordKind: "harvest" as const,
    grade: grade as HarvestFixtureGrade,
    observedQuantity,
    targetQuantity,
    createsHarvestInventory: true as const,
  };

  if (remainingQuantity <= 0) {
    return { ...base, state: "target_met", remainingQuantity: 0 };
  }
  if (moreAvailability === "yes") {
    return { ...base, state: "remaining", remainingQuantity };
  }
  if (moreAvailability === "unsure") {
    return { ...base, state: "availability_uncertain", remainingQuantity };
  }
  return { ...base, state: "closed_short", remainingQuantity };
}
