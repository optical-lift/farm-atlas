import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { readAtlasTaskMoveContexts } from "@/lib/atlas/task-move-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };
type AtlasTaskCardRow = { task_id: string; [key: string]: unknown };
type SupersededTaskRow = {
  id: string;
  farm_id: string;
  metadata: Record<string, unknown> | null;
};
type AtlasServerClient = Awaited<ReturnType<typeof createAtlasServerClient>>;

const MAX_SUPERSESSION_HOPS = 8;

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
}

function readTaskCards(
  supabase: AtlasServerClient,
  operatorMembershipId: string | null,
  farmId: string,
  taskId: string | null,
) {
  return operatorMembershipId
    ? supabase.rpc("owner_operator_task_cards_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
      })
    : supabase.rpc("task_cards_v1", {
        p_farm_id: farmId,
        p_task_id: taskId,
      });
}

function taskCardsError(error: unknown) {
  const rpcError = error as RpcError;
  if (rpcError.code === "42501") {
    return privateJson({ ok: false, error: "Farm access is not active." }, 403);
  }
  console.error("Atlas task cards read failed:", error);
  return privateJson({ ok: false, error: "Atlas task cards read failed." }, 500);
}

async function resolveSupersededTaskCard(
  supabase: AtlasServerClient,
  operatorMembershipId: string | null,
  farmId: string,
  requestedTaskId: string,
) {
  let currentTaskId = requestedTaskId;
  const visited = new Set([requestedTaskId]);

  for (let hop = 0; hop < MAX_SUPERSESSION_HOPS; hop += 1) {
    const { data: rawTask, error: taskError } = await supabase
      .schema("atlas")
      .from("tasks")
      .select("id, farm_id, metadata")
      .eq("id", currentTaskId)
      .eq("farm_id", farmId)
      .maybeSingle();

    if (taskError) {
      console.error("Atlas superseded task lookup failed:", taskError);
      return { rows: [] as AtlasTaskCardRow[], canonicalTaskId: requestedTaskId, error: taskError };
    }

    const task = rawTask as SupersededTaskRow | null;
    const nextTaskId = typeof task?.metadata?.superseded_by_task_id === "string"
      ? task.metadata.superseded_by_task_id.trim()
      : "";

    if (!task || !isUuid(nextTaskId) || visited.has(nextTaskId)) {
      return { rows: [] as AtlasTaskCardRow[], canonicalTaskId: currentTaskId, error: null };
    }

    visited.add(nextTaskId);
    currentTaskId = nextTaskId;

    const response = await readTaskCards(supabase, operatorMembershipId, farmId, currentTaskId);
    if (response.error) {
      return { rows: [] as AtlasTaskCardRow[], canonicalTaskId: currentTaskId, error: response.error };
    }

    const rows = (response.data ?? []) as AtlasTaskCardRow[];
    if (rows.length > 0) {
      return { rows, canonicalTaskId: currentTaskId, error: null };
    }
  }

  console.error("Atlas task supersession chain exceeded safety limit:", requestedTaskId);
  return { rows: [] as AtlasTaskCardRow[], canonicalTaskId: currentTaskId, error: null };
}

export async function GET(request: NextRequest) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = request.nextUrl.searchParams.get("taskId")?.trim() || null;
  if (taskId && !isUuid(taskId)) {
    return privateJson({ ok: false, error: "A valid task ID is required." }, 400);
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm task scope." }, 403);
  }

  const farmId = operatorMembershipId
    ? operatorContext?.effective.farmId
    : authorized.access.membership.farmId;
  if (!farmId) {
    return privateJson({ ok: false, error: "Farm access is not active." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = await readTaskCards(supabase, operatorMembershipId, farmId, taskId);
  if (response.error) return taskCardsError(response.error);

  let baseTaskCards = (response.data ?? []) as AtlasTaskCardRow[];
  let canonicalTaskId = taskId;
  let resolvedFromTaskId: string | null = null;

  if (taskId && baseTaskCards.length === 0) {
    const resolved = await resolveSupersededTaskCard(
      supabase,
      operatorMembershipId,
      farmId,
      taskId,
    );
    if (resolved.error) return taskCardsError(resolved.error);
    baseTaskCards = resolved.rows;
    canonicalTaskId = resolved.canonicalTaskId;
    if (baseTaskCards.length > 0 && canonicalTaskId !== taskId) {
      resolvedFromTaskId = taskId;
    }
  }

  if (taskId && baseTaskCards.length === 0) {
    return privateJson({ ok: false, error: "Task not found." }, 404);
  }

  let moveContexts = {} as Awaited<ReturnType<typeof readAtlasTaskMoveContexts>>;
  try {
    moveContexts = await readAtlasTaskMoveContexts(baseTaskCards.map((card) => card.task_id));
  } catch (contextError) {
    console.error("Atlas full-task Move context read failed:", contextError);
  }

  const taskCards = baseTaskCards.map((card) => ({
    ...card,
    move_context: moveContexts[card.task_id] ?? null,
  }));

  return privateJson({
    ok: true,
    farmKey: operatorMembershipId
      ? operatorContext?.effective.farmKey ?? "elm_farm"
      : authorized.access.membership.farmKey ?? "elm_farm",
    role: operatorMembershipId
      ? operatorContext?.effective.farmRole ?? operatorContext?.effective.role
      : authorized.access.membership.role,
    operatorMode: operatorContext?.isOperating ?? false,
    effectiveMembershipId: operatorMembershipId,
    requestedTaskId: taskId,
    canonicalTaskId,
    resolvedFromTaskId,
    taskCards,
  });
}
