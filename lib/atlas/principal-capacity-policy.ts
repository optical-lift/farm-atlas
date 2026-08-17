import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasPrincipalCapacityPolicy = {
  id: string;
  stableKey: string;
  name: string;
  weekdays: number[];
  localStart: string;
  localEnd: string;
  defaultDiscretionaryMinutes: number;
  maximumPlannedMinutes: number;
  effectiveFrom: string;
  effectiveThrough: string | null;
  active: boolean;
};

type CapacityPoliciesSelfResponse = {
  contractVersion?: string;
  policies?: AtlasPrincipalCapacityPolicy[];
};

export async function readAtlasPrincipalCapacityPolicies(): Promise<AtlasPrincipalCapacityPolicy[]> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("principal_capacity_policies_self_api_v1");
  if (error) throw new Error(`Atlas Principal capacity policy read failed: ${error.message}`);

  const payload = data as CapacityPoliciesSelfResponse | null;
  return Array.isArray(payload?.policies) ? payload.policies : [];
}
