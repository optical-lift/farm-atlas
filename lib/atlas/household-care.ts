import "server-only";

import { createAtlasServerClient } from "@/lib/supabase/server";

export type HouseholdCareSpace = {
  id: string;
  parentSpaceId: string | null;
  stableKey: string;
  name: string;
  spaceType: string;
  functionalTags: string[];
  floorLevel: string | null;
  careRelevant: boolean;
  active: boolean;
  sourceKind: string;
  confidence: "candidate" | "confirmed";
  confirmedAt: string | null;
  conditionState: "unknown" | "holding" | "needs_attention" | "losing_shape" | "needs_recovery";
  disposition: string;
  conditionKnown: boolean;
  lastObservedAt: string | null;
};

export type HouseholdCareDwelling = {
  id: string;
  stableKey: string;
  name: string;
  dwellingKind: string;
  active: boolean;
  spaces: HouseholdCareSpace[];
};

export type HouseholdCareAttention = {
  rhythmId: string;
  windowStart: string;
  windowEnd: string;
  expectedMinutes: number;
  zoneId: string;
  zoneNumber: number;
  zoneStableKey: string;
  zoneName: string;
  spaceId: string | null;
  spaceName: string | null;
  spaceType: string | null;
  floorLevel: string | null;
  functionalTags: string[];
  conditionState: string;
  disposition: string;
  conditionKnown: boolean;
  lastObservedAt: string | null;
  releaseKind: string;
  releasesExecutableWork: boolean;
};

export type HouseholdCareSnapshot = {
  household: { id: string; name: string; timezone: string };
  dwellings: HouseholdCareDwelling[];
  currentAttention: HouseholdCareAttention[];
};

export async function readPrincipalHouseholdCare(): Promise<HouseholdCareSnapshot | null> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_household_care_snapshot_v1");
  if (error) {
    if (error.message?.includes("Active Principal household required")) return null;
    throw new Error(error.message || "Unable to read Household Care.");
  }
  return (data ?? null) as HouseholdCareSnapshot | null;
}
