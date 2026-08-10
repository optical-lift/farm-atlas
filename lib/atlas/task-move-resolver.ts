import "server-only";

import type { AtlasTaskCard } from "@/lib/atlas/task-cards-client";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { getAtlasSession } from "@/lib/atlas/session";
import { readAtlasTaskMoveContexts } from "@/lib/atlas/task-move-context";
import { assembleTaskMove, type TaskMoveAssembly } from "@/lib/atlas/task-move-assembly";
import { createAtlasServerClient } from "@/lib/supabase/server";

type RpcError = { code?: string; message?: string };

async function readTaskCardForCurrentViewer(taskId: string): Promise<AtlasTaskCard | null> {
  const [operatorContext, session] = await Promise.all([
    readAtlasOwnerOperatorContext(),
    getAtlasSession(),
  ]);
  if (!session) return null;

  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  const activeFarmId = session.activeFarmId ?? session.memberships[0]?.farmId ?? null;
  if (!operatorMembershipId && !activeFarmId) return null;

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_task_cards_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
      })
    : await supabase.rpc("task_cards_v1", {
        p_farm_id: activeFarmId,
        p_task_id: taskId,
      });

  const { data, error } = response;
  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") return null;
    throw new Error(rpcError.message || "Atlas task card could not be loaded for Move assembly.");
  }

  return ((data ?? [])[0] as AtlasTaskCard | undefined) ?? null;
}

export async function resolveTaskMove(taskId: string): Promise<TaskMoveAssembly | null> {
  const id = taskId.trim();
  if (!id) return null;

  const card = await readTaskCardForCurrentViewer(id);
  if (!card) return null;

  const moveContexts = await readAtlasTaskMoveContexts([id]);
  return assembleTaskMove({
    ...card,
    move_context: moveContexts[id] ?? null,
  });
}
