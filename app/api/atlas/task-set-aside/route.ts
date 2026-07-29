import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "task_set_aside_forbidden", error.message || "This task cannot be set aside by the signed-in user.");
  if (error.code === "P0002") return atlasApiError(404, "task_not_found", "The task was not found.");
  if (error.code === "22023") return atlasApiError(400, "task_set_aside_rejected", error.message || "Atlas rejected this daily set-aside.");
  return atlasApiError(500, "task_set_aside_failed", "Atlas could not set this task aside.");
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const day = new URL(request.url).searchParams.get("day")?.trim() || null;
  if (day && !DATE_PATTERN.test(day)) return atlasApiError(400, "invalid_day", "Day must use YYYY-MM-DD.");

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("viewer_task_day_dispositions_v1", {
    p_day: day,
  });
  if (error) return rpcFailure(error);

  return privateJson({
    ok: true,
    dispositions: Array.isArray(data) ? data : [],
  });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-set-aside-v1") {
    return atlasApiError(400, "task_set_aside_intent_required", "A valid Atlas set-aside intent is required.");
  }

  let body: Record<string, unknown>;
  try {
    body = await readAtlasJsonBody(request);
  } catch {
    return atlasApiError(400, "invalid_set_aside_request", "The set-aside request is invalid.");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!UUID_PATTERN.test(taskId)) return atlasApiError(400, "invalid_task_id", "A valid task id is required.");
  if (!idempotencyKey || idempotencyKey.length > 160) return atlasApiError(400, "invalid_idempotency_key", "A valid idempotency key is required.");

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("set_task_aside_today_v1", {
    p_task_id: taskId,
    p_idempotency_key: idempotencyKey,
  });
  if (error) return rpcFailure(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_set_aside_result", "Atlas returned an invalid set-aside result.");
  }

  return privateJson({ ...data, ok: true });
}
