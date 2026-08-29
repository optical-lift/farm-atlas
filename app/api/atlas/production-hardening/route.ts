import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

type Body = {
  taskId?: unknown;
  observedDate?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "production-hardening-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: error.message || "This hardening task is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Production hardening task was not found." }, 404);
  if (error.code === "23514") return privateJson({ ok: false, error: error.message || "This hardening work is not executable in current farm reality." }, 409);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The hardening result was rejected." }, 400);
  console.error("Production hardening result failed", error);
  return privateJson({ ok: false, error: "Atlas could not save the hardening result." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Hardening results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON hardening result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const observedDate = clean(body.observedDate) || new Date().toISOString().slice(0, 10);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey) || `production-hardening:${taskId}:${observedDate}`;

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!DATE_PATTERN.test(observedDate)) return privateJson({ ok: false, error: "A valid hardening date is required." }, 400);

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm hardening scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  let response;
  if (operatorMembershipId) {
    response = await supabase.rpc("owner_operator_record_production_hardening_v1", {
      p_effective_membership_id: operatorMembershipId,
      p_task_id: taskId,
      p_observed_date: observedDate,
      p_note: note,
      p_idempotency_key: idempotencyKey,
    });
  } else if (authorized.access.membership.role === "owner") {
    response = await supabase.rpc("owner_record_production_hardening_v1", {
      p_task_id: taskId,
      p_observed_date: observedDate,
      p_note: note,
      p_idempotency_key: idempotencyKey,
    });
  } else {
    response = await supabase.rpc("worker_record_production_hardening_v1", {
      p_task_id: taskId,
      p_observed_date: observedDate,
      p_note: note,
      p_idempotency_key: idempotencyKey,
    });
  }

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid hardening result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
