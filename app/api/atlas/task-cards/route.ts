import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };
type AtlasTaskCardRow = { task_id: string; [key: string]: unknown };

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, max-age=0, must-revalidate" },
  });
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

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_task_cards_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
      })
    : await supabase.rpc("task_cards_v1", {
        p_farm_id: authorized.access.membership.farmId,
        p_task_id: taskId,
      });
  const { data, error } = response;

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") {
      return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    }
    console.error("Atlas task cards read failed:", error);
    return privateJson({ ok: false, error: "Atlas task cards read failed." }, 500);
  }

  const taskCards = (data ?? []) as AtlasTaskCardRow[];
  if (taskId && taskCards.length === 0) {
    return privateJson({ ok: false, error: "Task not found." }, 404);
  }

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
    taskCards,
  });
}
