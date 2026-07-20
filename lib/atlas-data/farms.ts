import { createAtlasServerClient } from "@/lib/supabase/server";

export type AtlasFarmRecord = {
  id: string;
  stable_key: string;
  name: string;
  status: string;
};

export async function getAuthorizedFarm(farmId: string): Promise<AtlasFarmRecord> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase
    .from("farms")
    .select("id, stable_key, name, status")
    .eq("id", farmId)
    .maybeSingle();

  if (error) throw new Error("Atlas farm read failed.");
  if (!data) throw new Error("Farm membership does not permit this read.");

  return data as AtlasFarmRecord;
}
