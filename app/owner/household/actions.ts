"use server";

import { revalidatePath } from "next/cache";

import { createAtlasServerClient } from "@/lib/supabase/server";

function stableKey(value: string) {
  const key = value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return key || `space-${Date.now()}`;
}

export async function createHouseholdDwelling(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;
  const supabase = await createAtlasServerClient();
  const { error } = await supabase.rpc("principal_upsert_dwelling_api_v1", {
    p_payload: { stableKey: stableKey(name), name, dwellingKind: "home" },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/household");
}

export async function createHouseholdSpace(formData: FormData) {
  const name = String(formData.get("name") ?? "").trim();
  const dwellingId = String(formData.get("dwellingId") ?? "");
  const spaceType = String(formData.get("spaceType") ?? "room");
  const floorLevel = String(formData.get("floorLevel") ?? "").trim();
  const tag = String(formData.get("functionalTag") ?? "").trim();
  if (!name || !dwellingId) return;
  const supabase = await createAtlasServerClient();
  const { error } = await supabase.rpc("principal_upsert_household_space_api_v1", {
    p_payload: {
      dwellingId,
      stableKey: stableKey(name),
      name,
      spaceType,
      floorLevel: floorLevel || null,
      functionalTags: tag ? [tag] : [],
      confidence: "confirmed",
      sourceKind: "principal_onboarding",
    },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/household");
}

export async function recordHouseholdCondition(formData: FormData) {
  const spaceId = String(formData.get("spaceId") ?? "");
  const conditionState = String(formData.get("conditionState") ?? "");
  if (!spaceId || !conditionState) return;
  const supabase = await createAtlasServerClient();
  const { error } = await supabase.rpc("principal_record_household_care_observation_api_v1", {
    p_payload: {
      spaceId,
      conditionState,
      sourceKey: `owner-household:${spaceId}:${Date.now()}`,
      metadata: { surface: "owner_household" },
    },
  });
  if (error) throw new Error(error.message);
  revalidatePath("/owner/household");
}
