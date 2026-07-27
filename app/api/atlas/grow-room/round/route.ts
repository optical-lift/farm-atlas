import { NextResponse } from "next/server";

import { readAtlasJsonBody, requireAtlasApiAccess } from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type RpcError = { code?: string; message?: string };

type ResolveInput = {
  type?: "resolve_request";
  visitTaskId?: string;
  requestTaskId?: string;
  transition?: "done" | "blocked" | "rescheduled" | "unfinished";
  idempotencyKey?: string;
  targetDate?: string | null;
  note?: string | null;
  reason?: string | null;
  payload?: Record<string, unknown>;
};

type FinishInput = {
  type?: "finish_round";
  visitTaskId?: string;
  idempotencyKey?: string;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
      "X-Atlas-Read-Path": "grow-room-round-v1",
    },
  });
}

function rpcStatus(error: RpcError) {
  if (error.code === "42501") return 403;
  if (error.code === "P0002") return 404;
  if (error.code === "22023") return 400;
  return 500;
}

function cleanId(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const visitTaskId = cleanId(new URL(request.url).searchParams.get("visitTaskId"));
  const supabase = await createAtlasServerClient();
  const { data, error } = await supabase.rpc("grow_room_round_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_visit_task_id: visitTaskId,
  });

  if (error) {
    console.error("Atlas Grow Room round read failed:", error);
    return privateJson({ ok: false, error: error.message || "The Grow Room round could not be loaded." }, rpcStatus(error as RpcError));
  }

  return privateJson({
    ok: true,
    farmKey: authorized.access.membership.farmKey ?? "elm_farm",
    role: authorized.access.membership.role,
    round: data,
  });
}

export async function POST(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let input: ResolveInput | FinishInput;
  try {
    input = await readAtlasJsonBody(request) as ResolveInput | FinishInput;
  } catch {
    return privateJson({ ok: false, error: "Grow Room round result must be valid JSON." }, 400);
  }

  const visitTaskId = cleanId(input.visitTaskId);
  const idempotencyKey = cleanId(input.idempotencyKey);
  if (!visitTaskId || !idempotencyKey) {
    return privateJson({ ok: false, error: "Grow Room task and idempotency key are required." }, 400);
  }

  const supabase = await createAtlasServerClient();

  if (input.type === "finish_round") {
    const { data, error } = await supabase.rpc("grow_room_finish_round_v1", {
      p_farm_id: authorized.access.membership.farmId,
      p_visit_task_id: visitTaskId,
      p_idempotency_key: idempotencyKey,
    });
    if (error) return privateJson({ ok: false, error: error.message || "The Grow Room round could not be finished." }, rpcStatus(error as RpcError));
    return privateJson({ ok: true, result: data });
  }

  if (input.type !== "resolve_request") {
    return privateJson({ ok: false, error: "Choose a valid Grow Room round result." }, 400);
  }

  const requestTaskId = cleanId(input.requestTaskId);
  const transition = input.transition;
  if (!requestTaskId || !transition || !["done", "blocked", "rescheduled", "unfinished"].includes(transition)) {
    return privateJson({ ok: false, error: "Request task and result are required." }, 400);
  }

  const { data, error } = await supabase.rpc("grow_room_resolve_round_request_v1", {
    p_farm_id: authorized.access.membership.farmId,
    p_visit_task_id: visitTaskId,
    p_request_task_id: requestTaskId,
    p_transition: transition,
    p_idempotency_key: idempotencyKey,
    p_target_date: input.targetDate ?? null,
    p_note: input.note ?? null,
    p_reason: input.reason ?? null,
    p_payload: input.payload ?? {},
  });

  if (error) {
    console.error("Atlas Grow Room request result failed:", error);
    return privateJson({ ok: false, error: error.message || "The Grow Room request could not be saved." }, rpcStatus(error as RpcError));
  }

  return privateJson({ ok: true, result: data });
}
