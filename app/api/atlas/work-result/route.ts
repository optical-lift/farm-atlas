import { NextResponse } from "next/server";

import {
  atlasApiError,
  readAtlasJsonBody,
  requireAtlasApiAccess,
} from "@/lib/atlas/api-access";
import {
  effectiveOperatorMembershipId,
  readAtlasOwnerOperatorContext,
} from "@/lib/atlas/operator-context";
import { createAtlasServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type RpcError = { code?: string; message?: string };

type WorkResultPostBody = {
  taskId?: unknown;
  values?: unknown;
  idempotencyKey?: unknown;
};

function privateJson(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

function workResultError(error: RpcError) {
  if (error.code === "42501") {
    return atlasApiError(403, "work_result_forbidden", "This result contract is not available to the selected account.");
  }
  if (error.code === "P0002") {
    return atlasApiError(404, "work_result_not_found", "The task or result contract was not found.");
  }
  if (error.code === "22023") {
    return atlasApiError(400, "work_result_rejected", error.message || "The structured result was rejected.");
  }
  return atlasApiError(500, "work_result_failed", "Atlas could not load or save the structured result.");
}

async function operatorMembershipId() {
  const context = await readAtlasOwnerOperatorContext();
  return effectiveOperatorMembershipId(context);
}

export async function GET(request: Request) {
  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  const taskId = new URL(request.url).searchParams.get("taskId")?.trim() ?? "";
  if (!UUID_PATTERN.test(taskId)) {
    return atlasApiError(400, "work_result_task_required", "A valid task is required.");
  }

  const supabase = await createAtlasServerClient();
  const effectiveMembershipId = await operatorMembershipId();
  const { data, error } = await supabase.rpc("work_result_contract_v1", {
    p_task_id: taskId,
    p_effective_membership_id: effectiveMembershipId,
  });

  if (error) return workResultError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_work_result_contract", "Atlas returned an invalid result contract.");
  }

  return privateJson({ ok: true, contract: data });
}

export async function POST(request: Request) {
  if (request.headers.get("x-atlas-intent") !== "structured-work-result-v1") {
    return atlasApiError(400, "work_result_intent_required", "A valid result intent is required.");
  }

  const authorized = await requireAtlasApiAccess();
  if (!authorized.ok) return authorized.response;

  let body: WorkResultPostBody;
  try {
    body = await readAtlasJsonBody(request) as WorkResultPostBody;
  } catch {
    return atlasApiError(400, "invalid_work_result_request", "The structured result request is invalid.");
  }

  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  const values = body.values;
  if (!UUID_PATTERN.test(taskId) || !idempotencyKey || !values || typeof values !== "object" || Array.isArray(values)) {
    return atlasApiError(400, "invalid_work_result_request", "Task, structured values, and idempotency key are required.");
  }

  const supabase = await createAtlasServerClient();
  const effectiveMembershipId = await operatorMembershipId();
  const { data, error } = await supabase.rpc("record_work_result_submission_v1", {
    p_task_id: taskId,
    p_values: values,
    p_idempotency_key: idempotencyKey,
    p_effective_membership_id: effectiveMembershipId,
  });

  if (error) return workResultError(error);
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return atlasApiError(500, "invalid_work_result_contract", "Atlas returned an invalid result contract.");
  }

  return privateJson({ ok: true, contract: data });
}
