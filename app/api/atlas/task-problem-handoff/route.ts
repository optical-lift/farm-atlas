import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

type Body = {
  action?: unknown;
  taskId?: unknown;
  issueText?: unknown;
  ownerResponse?: unknown;
  idempotencyKey?: unknown;
};

type RpcError = { code?: string; message?: string };

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function rpcError(error: RpcError) {
  if (error.code === "42501") return atlasApiError(403, "problem_handoff_forbidden", error.message || "This handoff is not allowed.");
  if (error.code === "P0002") return atlasApiError(404, "problem_handoff_not_found", error.message || "The task or handoff was not found.");
  if (error.code === "P0003") return atlasApiError(409, "problem_handoff_owner_missing", error.message || "No Owner is available for this handoff.");
  if (error.code === "22023") return atlasApiError(400, "problem_handoff_rejected", error.message || "The handoff was rejected.");
  return atlasApiError(500, "problem_handoff_failed", "Atlas could not update this problem handoff.");
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "task-problem-handoff-v1") {
    return atlasApiError(400, "problem_handoff_intent_required", "A valid Atlas problem handoff intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: Body;
  try {
    body = await readAtlasJsonBody(request) as Body;
  } catch {
    return atlasApiError(400, "problem_handoff_invalid_json", "The problem handoff request is invalid.");
  }

  const action = text(body.action);
  const taskId = text(body.taskId);
  const idempotencyKey = text(body.idempotencyKey);
  if (!taskId || !idempotencyKey || (action !== "open" && action !== "resolve")) {
    return atlasApiError(400, "problem_handoff_invalid_request", "Task, action, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const response = action === "open"
    ? await supabase.rpc("worker_open_task_problem_handoff_v1", {
        p_task_id: taskId,
        p_issue_text: text(body.issueText),
        p_idempotency_key: idempotencyKey,
      })
    : await supabase.rpc("owner_resolve_task_problem_handoff_v1", {
        p_task_id: taskId,
        p_owner_response: text(body.ownerResponse) || null,
        p_idempotency_key: idempotencyKey,
      });

  if (response.error) return rpcError(response.error);
  if (!response.data || typeof response.data !== "object" || Array.isArray(response.data)) {
    return atlasApiError(500, "problem_handoff_invalid_result", "Atlas returned an invalid problem handoff result.");
  }

  return privateJson({ ...response.data, ok: true });
}
