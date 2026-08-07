import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "worker_support_forbidden", error.message || "This worker support action is not available.");
  }
  if (error.code === "P0002") return atlasApiError(404, "task_not_found", "The task was not found.");
  return atlasApiError(500, "worker_support_failed", "Atlas could not adjust the work stream.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "worker-support-v1") {
    return atlasApiError(400, "worker_support_intent_required", "A valid worker support intent is required.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_worker_support_request", "The worker support request is invalid.");
  }

  const action = typeof body.action === "string" ? body.action.trim() : "";
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (action !== "need_lighter_work") {
    return atlasApiError(400, "invalid_worker_support_action", "This worker support action is not available.");
  }
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "invalid_task_id", "A valid task id is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;
  if (authorized.access.membership.role !== "farm_hand") {
    return atlasApiError(403, "farm_hand_required", "Need lighter work is a farm-hand work-stream action.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("report_worker_needs_lighter_work_v2", {
    p_task_id: taskId,
  });
  if (error) return rpcFailure(error);

  return privateJson({ ok: true, result: data });
}
