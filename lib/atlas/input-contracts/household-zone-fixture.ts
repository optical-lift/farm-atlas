import type { AtlasInputContract, AtlasInputResultEvent } from "@/lib/atlas/input-contract";

export const HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT: AtlasInputContract = {
  id: "fixture.household.flylady.living-room-zone.v1",
  kind: "household",
  title: "Living room",
  detail: "15-minute zone pass · record where the room is now",
  source: {
    domain: "household",
    jurisdiction: "person-private",
    objectRef: "fixture:household:flylady:zone-5:living-room",
    claimRef: "household-zone",
  },
  fields: [
    {
      primitive: "choice",
      id: "zoneCondition",
      label: "after 15 minutes",
      options: [
        { value: "still_rough", label: "still rough" },
        { value: "mostly_clear", label: "mostly clear" },
        { value: "all_clear", label: "all clear" },
      ],
    },
  ],
  rules: [
    {
      kind: "required_field",
      fieldId: "zoneCondition",
      message: "Record the room condition after the 15-minute pass.",
    },
  ],
  resultEventType: "atlas.household.zone_pass.result.fixture.v1",
  persistence: "fixture_only",
  sourceContext: {
    method: "flylady_zone_pass",
    zoneNumber: 5,
    zoneLabel: "Living room",
    plannedMinutes: 15,
  },
};

export type HouseholdZoneFixtureAdjudication = {
  state: "pass_logged";
  todayClaimSatisfied: true;
  observedCondition: "still_rough" | "mostly_clear" | "all_clear";
  futureZoneAttention: boolean;
};

export function adjudicateHouseholdZoneFixtureResult(
  event: AtlasInputResultEvent,
): HouseholdZoneFixtureAdjudication {
  if (event.eventType !== HOUSEHOLD_LIVING_ROOM_ZONE_INPUT_CONTRACT.resultEventType) {
    throw new Error("Household zone adjudication received the wrong Atlas result event.");
  }

  const condition = event.values.zoneCondition;
  if (condition !== "still_rough" && condition !== "mostly_clear" && condition !== "all_clear") {
    throw new Error("Household zone result is missing a valid observed condition.");
  }

  return {
    state: "pass_logged",
    todayClaimSatisfied: true,
    observedCondition: condition,
    futureZoneAttention: condition !== "all_clear",
  };
}
