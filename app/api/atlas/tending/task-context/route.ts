import { NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Read-Path": "tending-task-context-v1",
    },
  });
}

function stableKey(value: string | null) {
  const key = value?.trim() ?? "";
  return /^[a-zA-Z0-9_-]{1,180}$/.test(key) ? key : null;
}

function uuid(value: string | null) {
  const id = value?.trim() ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id) ? id : null;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const url = new URL(request.url);
  const taskId = uuid(url.searchParams.get("taskId"));
  const objectKey = stableKey(url.searchParams.get("objectKey"));
  if (!taskId || !objectKey) return privateJson({ ok: false, error: "Choose a valid Tending gate." }, 400);

  const workerKey = authorized.access.membership.workerKey?.trim().toLowerCase() || null;
  if (!workerKey) return privateJson({ ok: false, error: "This farm membership has no Atlas worker identity." }, 409);

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("tending_task_context_v2", {
    p_farm_id: authorized.access.membership.farmId,
    p_task_id: taskId,
    p_object_key: objectKey,
    p_worker_key: workerKey,
  });

  if (error) {
    const rpcError = error as RpcError;
    if (rpcError.code === "42501") return privateJson({ ok: false, error: "Farm access is not active." }, 403);
    if (rpcError.code === "P0002") return privateJson({ ok: false, error: "Tending context is not available for this task." }, 404);
    console.error("Atlas Tending task context read failed:", error);
    return privateJson({ ok: false, error: "Tending context failed to load." }, 500);
  }

  const prepared = (data ?? {}) as { miniGamesEnabled?: false; bed?: unknown };
  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    miniGamesEnabled: prepared.miniGamesEnabled ?? false,
    bed: prepared.bed,
  });
}
