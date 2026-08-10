import { NextRequest, NextResponse } from "next/server";

import { requireAtlasApiAccess } from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIONS = new Set(["ready", "failed"]);

type Body = {
  taskId?: unknown;
  action?: unknown;
  readyCount?: unknown;
  note?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function wholeNumber(value: unknown) {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, max-age=0, must-revalidate",
      "X-Atlas-Write-Path": "transplant-readiness-v1",
    },
  });
}

function rpcFailure(error: RpcError) {
  if (error.code === "42501") return privateJson({ ok: false, error: "This readiness task is outside the active worker context." }, 403);
  if (error.code === "P0002") return privateJson({ ok: false, error: "Transplant-readiness task was not found." }, 404);
  if (error.code === "22023" || error.code === "22P02") return privateJson({ ok: false, error: error.message || "The readiness result was rejected." }, 400);
  console.error("Transplant readiness result failed", error);
  return privateJson({ ok: false, error: "Atlas could not save the transplant-readiness result." }, 500);
}

export async function POST(request: NextRequest) {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin || requestOrigin !== request.nextUrl.origin) {
    return privateJson({ ok: false, error: "Readiness results require a same-origin Atlas request." }, 403);
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await request.json() as Body;
  } catch {
    return privateJson({ ok: false, error: "A JSON readiness result is required." }, 400);
  }

  const taskId = clean(body.taskId);
  const action = clean(body.action).toLowerCase();
  const readyCount = wholeNumber(body.readyCount);
  const note = clean(body.note) || null;
  const idempotencyKey = clean(body.idempotencyKey) || `transplant-readiness:${taskId}:${crypto.randomUUID()}`;

  if (!UUID_PATTERN.test(taskId)) return privateJson({ ok: false, error: "A valid task id is required." }, 400);
  if (!ACTIONS.has(action)) return privateJson({ ok: false, error: "Choose ready or failed." }, 400);
  if (action === "ready" && (readyCount === null || readyCount < 1)) {
    return privateJson({ ok: false, error: "Enter how many seedlings are transplant-ready." }, 400);
  }

  const operatorContext = await readAtlasOwnerOperatorContext();
  const operatorMembershipId = effectiveOperatorMembershipId(operatorContext);
  if (operatorContext?.isOperating && !operatorMembershipId) {
    return privateJson({ ok: false, error: "The selected account has no farm readiness scope." }, 403);
  }

  const supabase = await createAtlasServerClient();
  const response = operatorMembershipId
    ? await supabase.rpc("owner_operator_record_transplant_readiness_v1", {
        p_effective_membership_id: operatorMembershipId,
        p_task_id: taskId,
        p_action: action,
        p_ready_count: action === "failed" ? 0 : readyCount,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("worker_record_transplant_readiness_v1", {
        p_task_id: taskId,
        p_action: action,
        p_ready_count: action === "failed" ? 0 : readyCount,
        p_note: note,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcFailure(response.error as RpcError);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return privateJson({ ok: false, error: "Atlas returned an invalid readiness result." }, 500);
  }

  return privateJson({
    ...(response.data as Record<string, unknown>),
    ok: true,
    operatorMode: operatorContext?.isOperating ?? false,
  });
}
