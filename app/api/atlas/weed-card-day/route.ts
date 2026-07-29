import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import type { AtlasFinishWeedCardDayResult } from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: unknown;
  workDate?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "weed_card_forbidden", "This Weed Card is not assigned to the signed-in farm member.");
  if (error.code === "P0002") return atlasApiError(404, "weed_card_not_found", "The Weed Card was not found.");
  if (error.code === "22023") return atlasApiError(400, "weed_card_day_rejected", error.message || "Today's Weed Card could not be closed.");
  return atlasApiError(500, "weed_card_day_failed", "Atlas could not close today's Weed Card.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "weed-card-day-v1") {
    return atlasApiError(400, "weed_card_day_intent_required", "A valid Weed Card day intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await readAtlasJsonBody(request) as Body;
  } catch {
    return atlasApiError(400, "invalid_weed_card_day", "The Weed Card day request is invalid.");
  }

  const taskId = text(body.taskId);
  const workDate = text(body.workDate);
  const idempotencyKey = text(body.idempotencyKey);

  if (!taskId || !idempotencyKey || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return atlasApiError(400, "invalid_weed_card_day", "Task, date, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("finish_weed_card_day_v1", {
    p_task_id: taskId,
    p_work_date: workDate,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return rpcError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_weed_card_day_result", "Atlas returned an invalid Weed Card day result.");
  }

  return privateJson({ ...(data as AtlasFinishWeedCardDayResult), ok: true });
}
