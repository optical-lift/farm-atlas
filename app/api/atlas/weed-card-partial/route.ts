import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  ATLAS_WEED_CONDITIONS,
  type AtlasWeedCardSessionResult,
  type AtlasWeedCondition,
} from "@/lib/atlas/weed-card-contract";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  taskId?: unknown;
  minutes?: unknown;
  conditionAfter?: unknown;
  workDate?: unknown;
  note?: unknown;
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
  if (error.code === "22023") return atlasApiError(400, "weed_card_partial_rejected", error.message || "The partial Weed Card work was rejected.");
  return atlasApiError(500, "weed_card_partial_failed", "Atlas could not save the partial Weed Card work.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "weed-card-partial-v1") {
    return atlasApiError(400, "weed_card_intent_required", "A valid Weed Card intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await readAtlasJsonBody(request) as Body;
  } catch {
    return atlasApiError(400, "invalid_weed_card_partial", "The partial Weed Card request is invalid.");
  }

  const taskId = text(body.taskId);
  const idempotencyKey = text(body.idempotencyKey);
  const workDate = text(body.workDate);
  const note = text(body.note);
  const rawMinutes = body.minutes;
  const minutes = rawMinutes == null || rawMinutes === "" ? 0 : Number(rawMinutes);
  const conditionAfter = text(body.conditionAfter) as AtlasWeedCondition;

  if (!taskId || !idempotencyKey || !/^\d{4}-\d{2}-\d{2}$/.test(workDate)) {
    return atlasApiError(400, "invalid_weed_card_partial", "Task, date, and idempotency key are required.");
  }
  if (!Number.isInteger(minutes) || minutes < 0 || minutes > 480) {
    return atlasApiError(400, "invalid_weed_card_minutes", "Minutes must be a whole number between 0 and 480.");
  }
  if (!ATLAS_WEED_CONDITIONS.includes(conditionAfter) || conditionAfter === "clear") {
    return atlasApiError(400, "invalid_weed_card_condition", "Choose the bed's remaining condition, or use Clear.");
  }

  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("finish_partial_weed_card_day_v1", {
    p_task_id: taskId,
    p_minutes: minutes,
    p_condition_after: conditionAfter,
    p_work_date: workDate,
    p_note: note || null,
    p_idempotency_key: idempotencyKey,
  });

  if (error) return rpcError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_weed_card_result", "Atlas returned an invalid Weed Card result.");
  }

  return privateJson({ ...(data as AtlasWeedCardSessionResult), ok: true });
}