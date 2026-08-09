import "server-only";

import type { AtlasTaskMoveContext } from "@/lib/atlas/task-cards-client";
import { createAtlasServerClient } from "@/lib/supabase/server";

type RpcError = { message?: string };

export async function readAtlasTaskMoveContexts(taskIds: string[]) {
  const ids = Array.from(new Set(taskIds.filter(Boolean)));
  if (!ids.length) return {} as Record<string, AtlasTaskMoveContext>;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("task_move_context_batch_v1", {
    p_task_ids: ids,
  });

  if (error) {
    throw new Error((error as RpcError).message || "Atlas Move context could not be loaded.");
  }

  return (data ?? {}) as Record<string, AtlasTaskMoveContext>;
}
