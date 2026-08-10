import "server-only";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import { readAtlasTaskMoveContexts } from "@/lib/atlas/task-move-context";
import { assembleTaskMove, type TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";
import { createAtlasServerClient } from "@/lib/supabase/server";

type ReadError = { message?: string };

function uniqueTaskIds(taskIds: string[]) {
  return Array.from(new Set(taskIds.map((taskId) => taskId.trim()).filter(Boolean)));
}

export async function resolveTaskMoves(taskIds: string[]): Promise<TaskMoveAssembly[]> {
  const ids = uniqueTaskIds(taskIds);
  if (!ids.length) return [];

  const supabase = await createAtlasServerClient();
  const [{ data, error }, moveContexts] = await Promise.all([
    supabase.from("v_task_cards").select("*").in("task_id", ids),
    readAtlasTaskMoveContexts(ids),
  ]);

  if (error) {
    throw new Error((error as ReadError).message || "Atlas task cards could not be loaded for Move assembly.");
  }

  const cards = (data ?? []) as AtlasTaskCard[];
  const byId = new Map(cards.map((card) => [card.task_id, card]));

  return ids.flatMap((taskId) => {
    const card = byId.get(taskId);
    if (!card) return [];
    return [assembleTaskMove({
      ...card,
      move_context: moveContexts[taskId] ?? null,
    })];
  });
}

export async function resolveTaskMove(taskId: string): Promise<TaskMoveAssembly | null> {
  const [assembly] = await resolveTaskMoves([taskId]);
  return assembly ?? null;
}
