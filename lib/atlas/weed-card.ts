import "server-only";

import type { AtlasWeedCardContext } from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export async function readAtlasWeedCardTask(taskId: string): Promise<AtlasWeedCardContext | null> {
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("weed_card_task_focus_v1", { p_task_id: taskId });
  if (error) {
    if (error.code === "P0002") return null;
    throw new Error(error.message);
  }
  return (data as AtlasWeedCardContext | null) ?? null;
}
