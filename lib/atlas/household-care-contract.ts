import {
  decideAtlasCareRelease,
  type AtlasCareAssessment,
  type AtlasCareReleaseDecision,
} from "./care-contract";

export type AtlasHouseholdCareZoneKey =
  | "arrival_transition"
  | "food_kitchen"
  | "hygiene_secondary"
  | "primary_sleeping"
  | "primary_gathering";

export type AtlasHouseholdSpaceFunctionalTag =
  | "arrival"
  | "transition"
  | "dining"
  | "food"
  | "kitchen"
  | "pantry"
  | "hygiene"
  | "secondary_room"
  | "primary_sleeping"
  | "dressing"
  | "primary_gathering"
  | "laundry"
  | "storage"
  | "children"
  | "work"
  | "utility";

export type AtlasHouseholdCareZoneTemplate = {
  zoneKey: AtlasHouseholdCareZoneKey;
  ordinal: 1 | 2 | 3 | 4 | 5;
  label: string;
  functionalTags: AtlasHouseholdSpaceFunctionalTag[];
};

export type AtlasHouseholdSpaceRef = {
  householdId: string;
  dwellingId: string;
  spaceId: string;
  label: string;
  spaceType: string;
  functionalTags: AtlasHouseholdSpaceFunctionalTag[];
  /**
   * Spatial topology belongs to the household map. It is intentionally not a
   * zone selector: "upstairs" and "basement" do not tell Atlas what kind of
   * care a space needs.
   */
  floorLevel?: string | null;
};

export const ATLAS_HOUSEHOLD_CARE_POLICY = {
  policyKey: "atlas_household_five_zone_attention",
  policyVersion: 1,
  label: "Atlas Household Rhythm",
  principles: [
    "daily maintenance",
    "weekly recurring care",
    "rotating five-zone attention",
    "bounded attention rather than whole-zone completion",
    "declutter before detail care",
    "elapsed time creates attention or reassessment, not physical condition",
  ],
} as const;

/**
 * Product-owned, universal zone definitions. Household-specific rooms are
 * matched to these functional templates rather than copied into the policy.
 */
export const ATLAS_HOUSEHOLD_CARE_ZONE_TEMPLATES: AtlasHouseholdCareZoneTemplate[] = [
  {
    zoneKey: "arrival_transition",
    ordinal: 1,
    label: "Arrival + transition spaces",
    functionalTags: ["arrival", "transition", "dining"],
  },
  {
    zoneKey: "food_kitchen",
    ordinal: 2,
    label: "Food + kitchen spaces",
    functionalTags: ["food", "kitchen", "pantry"],
  },
  {
    zoneKey: "hygiene_secondary",
    ordinal: 3,
    label: "Hygiene + secondary spaces",
    functionalTags: ["hygiene", "secondary_room"],
  },
  {
    zoneKey: "primary_sleeping",
    ordinal: 4,
    label: "Primary sleeping + dressing spaces",
    functionalTags: ["primary_sleeping", "dressing"],
  },
  {
    zoneKey: "primary_gathering",
    ordinal: 5,
    label: "Primary gathering spaces",
    functionalTags: ["primary_gathering"],
  },
];

export function householdCareZoneTemplate(
  zoneKey: AtlasHouseholdCareZoneKey,
): AtlasHouseholdCareZoneTemplate {
  const template = ATLAS_HOUSEHOLD_CARE_ZONE_TEMPLATES.find(
    (candidate) => candidate.zoneKey === zoneKey,
  );

  if (!template) {
    throw new Error(`Unknown household care zone: ${zoneKey}`);
  }

  return template;
}

/**
 * Match by function, never by floor name. A basement may be laundry, storage,
 * a playroom, a workshop, or several of those; its topology alone is not care
 * meaning.
 */
export function householdCareZonesForSpace(
  space: AtlasHouseholdSpaceRef,
): AtlasHouseholdCareZoneKey[] {
  const tags = new Set(space.functionalTags);

  return ATLAS_HOUSEHOLD_CARE_ZONE_TEMPLATES.filter((template) =>
    template.functionalTags.some((tag) => tags.has(tag)),
  ).map((template) => template.zoneKey);
}

export type AtlasHouseholdZoneAttention = {
  assessment: AtlasCareAssessment;
  release: AtlasCareReleaseDecision;
  zone: AtlasHouseholdCareZoneTemplate;
};

/**
 * A zone rotation protects attention; it does not assert that any room is
 * dirty and it does not manufacture a cleaning task. Physical-space condition
 * and an actual intervention are resolved later from household truth.
 */
export function buildHouseholdZoneAttention(input: {
  householdId: string;
  zoneKey: AtlasHouseholdCareZoneKey;
  attentionEligible: boolean;
}): AtlasHouseholdZoneAttention {
  const zone = householdCareZoneTemplate(input.zoneKey);
  const assessment: AtlasCareAssessment = {
    subject: {
      kind: "attention_scope",
      domainKey: "household",
      objectType: "household_care_zone",
      objectId: `${input.householdId}:${zone.zoneKey}`,
      objectKey: zone.zoneKey,
      label: zone.label,
    },
    policy: {
      policyKey: ATLAS_HOUSEHOLD_CARE_POLICY.policyKey,
      policyVersion: ATLAS_HOUSEHOLD_CARE_POLICY.policyVersion,
      label: ATLAS_HOUSEHOLD_CARE_POLICY.label,
    },
    disposition: "reassess",
    condition: {
      known: false,
      value: null,
      reportedAt: null,
      source: null,
      inferredFromClock: false,
    },
    reason: "protected_zone_rotation",
  };

  return {
    assessment,
    release: decideAtlasCareRelease({
      assessment,
      attentionEligible: input.attentionEligible,
      intervention: null,
      executionEnabled: false,
    }),
    zone,
  };
}
